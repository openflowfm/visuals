//! Bound acquisition, not just its UI. A timed-out worker cannot install a late
//! stream. Core Audio calls cannot be forcibly interrupted; while one is still
//! inside the driver, reject retries rather than accumulate blocked workers.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, LazyLock, Mutex,
};
use std::time::Duration;

const DEADLINE: Duration = Duration::from_secs(20);
static CONNECTOR: LazyLock<Connector> = LazyLock::new(Connector::default);
#[derive(Default)]
pub(super) struct Connector {
    busy: Arc<AtomicBool>,
}
#[derive(Clone)]
pub(super) struct Attempt {
    cancelled: Arc<AtomicBool>,
    stage: Arc<Mutex<&'static str>>,
}
impl Attempt {
    pub fn stage(&self, stage: &'static str) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err("Audio connection was cancelled".into());
        }
        *self.stage.lock().unwrap() = stage;
        eprintln!("audio connection: {stage}");
        Ok(())
    }
}
struct Busy(Arc<AtomicBool>);
// Result drops before admission is released when a retired worker cannot deliver it.
struct Mailbox<T> {
    cancelled: bool,
    completion: Option<Completion<T>>,
}
struct Completion<T> {
    result: Result<T, String>,
    permit: Busy,
}
impl Drop for Busy {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
pub(super) fn run<T: Send + 'static>(open: impl FnOnce(Attempt) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    CONNECTOR.run(DEADLINE, open)
}
impl Connector {
    #[cfg(test)]
    pub(super) fn pending(&self) -> bool {
        self.busy.load(Ordering::Acquire)
    }
    pub(super) fn run<T: Send + 'static>(&self, timeout: Duration, open: impl FnOnce(Attempt) -> Result<T, String> + Send + 'static) -> Result<T, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "The previous audio connection is still waiting on macOS. Finish any permission prompt and retry. If it remains stuck, restart visual[flow].".to_string())?;
        let permit = Busy(self.busy.clone());
        let attempt = Attempt { cancelled: Arc::new(AtomicBool::new(false)), stage: Arc::new(Mutex::new("finding the audio source")) };
        let worker = attempt.clone();
        let mailbox = Arc::new((Mutex::new(Mailbox { cancelled: false, completion: None }), Condvar::new()));
        let delivery = mailbox.clone();
        std::thread::Builder::new()
            .name("audio connection".into())
            .spawn(move || {
                let result = open(worker);
                let completion = Completion { result, permit };
                let (lock, ready) = &*delivery;
                let mut mail = lock.lock().unwrap();
                if !mail.cancelled {
                    mail.completion = Some(completion);
                    ready.notify_one();
                } else {
                    // Never put a late stream in a channel the IPC caller may have
                    // to drop: retired native resources are destroyed on this worker.
                    drop(mail);
                    drop(completion);
                }
            })
            .map_err(|e| format!("Couldn't start audio connection: {e}"))?;
        let (lock, ready) = &*mailbox;
        let mail = lock.lock().unwrap();
        let (mut mail, _) = ready.wait_timeout_while(mail, timeout, |mail| mail.completion.is_none()).unwrap();
        if let Some(Completion { result, permit }) = mail.completion.take() {
            drop(permit);
            return result;
        }
        mail.cancelled = true;
        attempt.cancelled.store(true, Ordering::Release);
        drop(mail);
        let stage = *attempt.stage.lock().unwrap();
        eprintln!("audio connection timed out: {stage}");
        Err(format!("Audio connection timed out while {stage}. The previous source is unchanged. Finish any macOS permission prompt and retry."))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    #[test]
    fn timed_out_open_cannot_return_a_late_stream_and_does_not_spawn_more_workers() {
        struct Stream(mpsc::Sender<()>);
        impl Drop for Stream {
            fn drop(&mut self) {
                let _ = self.0.send(());
            }
        }
        let connector = Connector::default();
        let (release, wait) = mpsc::channel();
        let (dropped, was_dropped) = mpsc::channel();
        let result = connector.run(Duration::from_millis(20), move |attempt| {
            attempt.stage("building the input stream")?;
            wait.recv().unwrap();
            Ok(Stream(dropped))
        });
        assert!(result.err().unwrap().contains("building the input stream"));
        assert!(connector.run(Duration::from_millis(20), |_| -> Result<(), String> { panic!("must not spawn another open") }).is_err());
        release.send(()).unwrap();
        was_dropped.recv_timeout(Duration::from_secs(1)).expect("late stream must be disposed");
    }
    #[test]
    fn slow_late_stream_cleanup_stays_on_worker_and_holds_admission() {
        struct SlowDrop {
            started: mpsc::Sender<()>,
            release: mpsc::Receiver<()>,
        }
        impl Drop for SlowDrop {
            fn drop(&mut self) {
                self.started.send(()).unwrap();
                self.release.recv().unwrap();
            }
        }
        let connector = Connector::default();
        let (open_release, open_wait) = mpsc::channel();
        let (drop_started, drop_wait) = mpsc::channel();
        let (drop_release, drop_finish) = mpsc::channel();
        let result = connector.run(Duration::from_millis(20), move |_| {
            open_wait.recv().unwrap();
            Ok(SlowDrop { started: drop_started, release: drop_finish })
        });
        assert!(result.is_err()); // IPC returned before either the open or its cleanup finishes.
        open_release.send(()).unwrap();
        drop_wait.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(connector.pending());
        assert!(connector.run(Duration::from_millis(20), |_| -> Result<(), String> { panic!("old cleanup still owns admission") }).is_err());
        drop_release.send(()).unwrap();
        let start = std::time::Instant::now();
        while connector.pending() {
            assert!(start.elapsed() < Duration::from_secs(1));
            std::thread::yield_now();
        }
        assert_eq!(connector.run(Duration::from_secs(1), |_| Ok(7)), Ok(7));
    }
    #[test]
    fn cancellation_is_checked_before_the_next_native_phase() {
        let connector = Connector::default();
        let (release, wait) = mpsc::channel();
        let (checked, check) = mpsc::channel();
        let result = connector.run(Duration::from_millis(20), move |attempt| {
            wait.recv().unwrap();
            let next = attempt.stage("starting capture");
            checked.send(next.is_err()).unwrap();
            next
        });
        assert!(result.is_err());
        release.send(()).unwrap();
        assert!(check.recv_timeout(Duration::from_secs(1)).unwrap());
    }
    #[test]
    fn native_errors_and_success_return_without_poisoning_following_connections() {
        let connector = Connector::default();
        assert_eq!(connector.run(Duration::from_secs(1), |_| Err::<(), _>("permission denied".into())), Err("permission denied".into()));
        // A completed result must release admission before the next caller receives it.
        assert_eq!(connector.run(Duration::from_secs(1), |_| Ok(42)), Ok(42));
    }
}
