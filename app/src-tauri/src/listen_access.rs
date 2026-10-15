//! macOS's microphone permission, settled before an input device is opened.
//!
//! Opening an input while the permission is undecided makes Core Audio wait
//! inside the driver for the user's answer to macOS's prompt, so the open
//! itself stalls until the connection's deadline and reads as a timeout. Asking
//! first, through AVFoundation, waits on the prompt instead, where a slow answer
//! is the user's and not the device's; a refusal fails at once, saying where to
//! turn it on. Once allowed, an open that is slow is the device's, and fails fast.

use std::time::Duration;

/// How long macOS's prompt may wait for an answer.
const ANSWER: Duration = Duration::from_secs(60);

/// Where the microphone permission is turned on.
pub const NOT_ALLOWED: &str = "visual[flow] isn't allowed to use microphones and audio inputs: turn it on in System Settings › Privacy & Security › Microphone, then pick the input again";

/// Ok when inputs may be opened: allowed before, or allowed now in macOS's
/// prompt (which waits up to a minute for the answer). Why not otherwise.
pub fn microphone_allowed() -> Result<(), String> {
    match mac::status() {
        mac::Status::Authorized => Ok(()),
        mac::Status::Denied | mac::Status::Restricted => Err(NOT_ALLOWED.into()),
        mac::Status::NotDetermined => match mac::request(ANSWER) {
            Some(true) => Ok(()),
            Some(false) => Err(NOT_ALLOWED.into()),
            None => Err("macOS is still asking whether visual[flow] may use the microphone. Answer its prompt, then pick the input again".into()),
        },
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    pub enum Status {
        NotDetermined,
        Restricted,
        Denied,
        Authorized,
    }
    pub fn status() -> Status {
        Status::Authorized
    }
    pub fn request(_: std::time::Duration) -> Option<bool> {
        Some(true)
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use block2::RcBlock;
    use objc2::runtime::{AnyClass, Bool};
    use objc2::msg_send;
    use objc2_foundation::NSString;
    use std::sync::mpsc;
    use std::time::Duration;

    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {
        static AVMediaTypeAudio: &'static NSString;
    }

    /// `AVAuthorizationStatus`.
    pub enum Status {
        NotDetermined,
        Restricted,
        Denied,
        Authorized,
    }

    fn device_class() -> Option<&'static AnyClass> {
        AnyClass::get(c"AVCaptureDevice")
    }

    pub fn status() -> Status {
        // Without AVFoundation's class, leave it to Core Audio as before.
        let Some(class) = device_class() else { return Status::Authorized };
        let status: isize = unsafe { msg_send![class, authorizationStatusForMediaType: AVMediaTypeAudio] };
        match status {
            0 => Status::NotDetermined,
            1 => Status::Restricted,
            2 => Status::Denied,
            _ => Status::Authorized,
        }
    }

    /// Ask macOS (its prompt), waiting up to `within` for the answer; None when none came.
    pub fn request(within: Duration) -> Option<bool> {
        let class = device_class()?;
        let (answer, answered) = mpsc::channel();
        let block = RcBlock::new(move |granted: Bool| {
            let _ = answer.send(granted.as_bool());
        });
        let _: () = unsafe { msg_send![class, requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*block] };
        answered.recv_timeout(within).ok()
    }
}
