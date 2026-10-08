//! Listening to another app's sound, or the whole Mac's, without a loopback
//! device: a Core Audio process tap (macOS 14.4 and later).
//!
//! A tap mixes the sound some processes play down to stereo. Core Audio only
//! reads a tap through a device, so each [`Tap`] makes a private aggregate
//! device holding just the tap, reads it with an IOProc and writes the two
//! channels into the engine's ring, as an input device does
//! ([`engine::live::open_input`]). The first tap asks for permission once
//! (`NSAudioCaptureUsageDescription` in `Info.plist`); without it a tap hears
//! silence.

use engine::live::{Ring, WINDOW};

/// The DAWs the picker names first, by the start of their bundle identifier
/// (Cubase's carries its version).
pub const DAWS: [(&str, &str); 14] = [
    ("com.ableton.live", "Ableton Live"),
    ("com.apple.logic", "Logic Pro"),
    ("com.bitwig.", "Bitwig Studio"),
    ("com.image-line.flstudio", "FL Studio"),
    ("com.cockos.reaper", "REAPER"),
    ("com.apple.garageband", "GarageBand"),
    ("com.presonus.studioone", "Studio One"),
    ("com.steinberg.cubase", "Cubase"),
    ("com.steinberg.nuendo", "Nuendo"),
    ("com.avid.ProTools", "Pro Tools"),
    ("com.renoise.", "Renoise"),
    ("com.propellerheads.reason", "Reason"),
    ("com.reasonstudios.", "Reason"),
    ("com.harrisonconsoles.mixbus", "Mixbus"),
];

/// The DAW `bundle` belongs to, by name.
pub fn daw(bundle: &str) -> Option<&'static str> {
    DAWS.iter().find(|(start, _)| bundle.starts_with(start)).map(|(_, name)| *name)
}

/// Whether `bundle` is `app` or one of its helpers (`com.google.Chrome.helper`
/// plays Chrome's sound).
pub fn belongs(bundle: &str, app: &str) -> bool {
    bundle == app || bundle.strip_prefix(app).is_some_and(|rest| rest.starts_with('.'))
}

/// The app a helper process plays for: `com.google.Chrome.helper.renderer`
/// plays Chrome's sound.
pub fn app_of(bundle: &str) -> &str {
    bundle.find(".helper").map_or(bundle, |at| &bundle[..at])
}

/// Write the frames in `buffers` into `ring`, channels `left` and `right` of
/// each frame. Each buffer is its samples and how many channels are
/// interleaved in it; channels count on from one buffer into the next, so
/// one interleaved buffer and one buffer per channel both work.
fn feed(buffers: &[(&[f32], usize)], (left, right): (usize, usize), ring: &Ring) {
    let channel = |c: usize| -> Option<(&[f32], usize, usize)> {
        let mut first = 0;
        for &(samples, n) in buffers {
            if c < first + n {
                return Some((samples, n.max(1), c - first));
            }
            first += n;
        }
        None
    };
    let (Some(l), Some(r)) = (channel(left).or_else(|| channel(0)), channel(right).or_else(|| channel(0))) else {
        return;
    };
    let frames = (l.0.len() / l.1).min(r.0.len() / r.1);
    // Never wait on the render thread from the audio thread.
    if let Ok(mut ring) = ring.try_lock() {
        for i in 0..frames {
            ring.0.push_back(l.0[i * l.1 + l.2]);
            ring.1.push_back(r.0[i * r.1 + r.2]);
        }
        while ring.0.len() > WINDOW {
            ring.0.pop_front();
            ring.1.pop_front();
        }
    }
}

/// A process Core Audio knows.
#[derive(Clone, Debug)]
pub struct Process {
    /// Its Core Audio object.
    pub object: u32,
    pub pid: i32,
    /// Empty for a process outside an app bundle.
    pub bundle: String,
    /// Whether it is playing sound now.
    pub playing: bool,
}

/// What a tap hears.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    /// These processes' sound (their Core Audio objects), mixed.
    Processes(Vec<u32>),
    /// Everything the Mac plays.
    Everything,
}

/// Whether this app may hear other apps.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Permission {
    Granted,
    Denied,
    /// Not asked yet: the first tap asks.
    Unknown,
}

#[cfg(target_os = "macos")]
pub use mac::*;

#[cfg(not(target_os = "macos"))]
pub use other::*;

/// Elsewhere there are no taps.
#[cfg(not(target_os = "macos"))]
mod other {
    use super::{Permission, Process, Target};
    use engine::live::Ring;

    pub fn supported() -> bool {
        false
    }
    pub fn permission() -> Permission {
        Permission::Denied
    }
    pub fn processes() -> Vec<Process> {
        vec![]
    }
    pub fn app_name(_pid: i32) -> Option<String> {
        None
    }
    pub struct Tap {
        pub rate: f32,
        pub channels: usize,
    }
    pub fn open(_target: &Target, _channels: (usize, usize), _ring: Ring) -> Result<Tap, String> {
        Err("listening to apps needs a Mac".into())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{feed, Permission, Process, Target};
    use engine::live::Ring;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_core_audio::*;
    use objc2_core_audio_types::{AudioBuffer, AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp};
    use objc2_core_foundation::CFDictionary;
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSOperatingSystemVersion, NSProcessInfo, NSString};
    use std::ffi::{c_void, CStr};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

    /// Whether this Mac can tap an app's or the system's sound.
    pub fn supported() -> bool {
        NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion { majorVersion: 14, minorVersion: 4, patchVersion: 0 })
    }

    unsafe extern "C" {
        fn dlopen(path: *const std::ffi::c_char, mode: i32) -> *mut c_void;
        fn dlsym(handle: *mut c_void, name: *const std::ffi::c_char) -> *mut c_void;
    }

    /// The privacy framework's function `name`. macOS has no public call to
    /// ask whether this app may listen to others, so this uses the one System
    /// Settings does, found at run time so a Mac without it just isn't asked.
    fn tcc(name: &CStr) -> Option<*mut c_void> {
        static FRAMEWORK: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
        let handle = *FRAMEWORK.get_or_init(|| unsafe { dlopen(c"/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC".as_ptr(), 1) } as usize);
        if handle == 0 {
            return None;
        }
        let f = unsafe { dlsym(handle as *mut c_void, name.as_ptr()) };
        (!f.is_null()).then_some(f)
    }

    const SERVICE: &str = "kTCCServiceAudioCapture";

    pub fn permission() -> Permission {
        let Some(f) = tcc(c"TCCAccessPreflight") else { return Permission::Unknown };
        let preflight: unsafe extern "C" fn(*const c_void, *const c_void) -> i32 = unsafe { std::mem::transmute(f) };
        let service = NSString::from_str(SERVICE);
        match unsafe { preflight(Retained::as_ptr(&service).cast(), std::ptr::null()) } {
            0 => Permission::Granted,
            1 => Permission::Denied,
            _ => Permission::Unknown,
        }
    }

    fn address(selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress { mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain }
    }

    fn check(what: &str, status: i32) -> Result<(), String> {
        if status == 0 { Ok(()) } else { Err(format!("{what} failed ({status})")) }
    }

    /// A fixed-size property of a Core Audio object.
    fn get<T: Copy>(object: AudioObjectID, selector: AudioObjectPropertySelector) -> Option<T> {
        let mut value = std::mem::MaybeUninit::<T>::uninit();
        let mut size = std::mem::size_of::<T>() as u32;
        let status = unsafe { AudioObjectGetPropertyData(object, NonNull::from(&address(selector)), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::new(value.as_mut_ptr().cast()).unwrap()) };
        (status == 0 && size as usize == std::mem::size_of::<T>()).then(|| unsafe { value.assume_init() })
    }

    /// A list of object IDs, such as the processes Core Audio knows.
    fn get_ids(object: AudioObjectID, selector: AudioObjectPropertySelector) -> Vec<AudioObjectID> {
        let mut size = 0u32;
        if unsafe { AudioObjectGetPropertyDataSize(object, NonNull::from(&address(selector)), 0, std::ptr::null(), NonNull::from(&mut size)) } != 0 {
            return vec![];
        }
        let mut ids = vec![0 as AudioObjectID; size as usize / 4];
        if ids.is_empty() {
            return ids;
        }
        let status = unsafe { AudioObjectGetPropertyData(object, NonNull::from(&address(selector)), 0, std::ptr::null(), NonNull::from(&mut size), NonNull::new(ids.as_mut_ptr().cast()).unwrap()) };
        if status != 0 {
            return vec![];
        }
        ids.truncate(size as usize / 4);
        ids
    }

    fn get_string(object: AudioObjectID, selector: AudioObjectPropertySelector) -> Option<String> {
        let raw: *mut NSString = get(object, selector)?;
        // Core Audio hands the string over retained.
        let s = unsafe { Retained::from_raw(raw) }?;
        Some(s.to_string())
    }

    /// The processes Core Audio knows: any that has opened audio.
    pub fn processes() -> Vec<Process> {
        get_ids(kAudioObjectSystemObject as AudioObjectID, kAudioHardwarePropertyProcessObjectList)
            .into_iter()
            .map(|object| Process {
                object,
                pid: get::<i32>(object, kAudioProcessPropertyPID).unwrap_or(-1),
                bundle: get_string(object, kAudioProcessPropertyBundleID).unwrap_or_default(),
                playing: get::<u32>(object, kAudioProcessPropertyIsRunningOutput).unwrap_or(0) != 0,
            })
            .collect()
    }

    /// The name the Dock shows for the app running as `pid`.
    pub fn app_name(pid: i32) -> Option<String> {
        let app = objc2_app_kit::NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
        app.localizedName().map(|n| n.to_string())
    }

    /// What the IOProc reads: kept boxed at a fixed address for the tap's life.
    struct Feed {
        ring: Ring,
        channels: (usize, usize),
        /// How many times Core Audio has handed the tap's sound over.
        reads: AtomicU64,
    }

    /// A tap being listened to. Dropping it stops listening and removes the tap
    /// and its device.
    pub struct Tap {
        tap: AudioObjectID,
        device: AudioObjectID,
        proc_id: AudioDeviceIOProcID,
        feed: *mut Feed,
        pub rate: f32,
        /// The tap's channel count: 2, as it mixes down to stereo.
        pub channels: usize,
    }

    // The IDs are plain numbers; `feed` is only read on Core Audio's thread
    // until `drop` has stopped it.
    unsafe impl Send for Tap {}

    static COUNT: AtomicU32 = AtomicU32::new(0);

    fn object<T: objc2::Message>(r: Retained<T>) -> Retained<AnyObject> {
        unsafe { Retained::cast_unchecked(r) }
    }

    fn key(k: &CStr) -> Retained<NSString> {
        NSString::from_str(k.to_str().unwrap())
    }

    unsafe extern "C-unwind" fn io(
        _device: AudioObjectID,
        _now: NonNull<AudioTimeStamp>,
        input: NonNull<AudioBufferList>,
        _input_time: NonNull<AudioTimeStamp>,
        _output: NonNull<AudioBufferList>,
        _output_time: NonNull<AudioTimeStamp>,
        client: *mut c_void,
    ) -> i32 {
        let to = unsafe { &*(client as *const Feed) };
        let list = unsafe { input.as_ref() };
        let all: &[AudioBuffer] = unsafe { std::slice::from_raw_parts(list.mBuffers.as_ptr(), list.mNumberBuffers as usize) };
        let mut buffers: [(&[f32], usize); 8] = [(&[], 0); 8];
        let n = all.len().min(buffers.len());
        for (slot, b) in buffers.iter_mut().zip(all) {
            let samples = if b.mData.is_null() { &[][..] } else { unsafe { std::slice::from_raw_parts(b.mData as *const f32, b.mDataByteSize as usize / 4) } };
            *slot = (samples, b.mNumberChannels as usize);
        }
        feed(&buffers[..n], to.channels, &to.ring);
        to.reads.fetch_add(1, Ordering::Relaxed);
        0
    }

    #[cfg(test)]
    impl Tap {
        /// How many times Core Audio has handed the tap's sound over: it keeps
        /// counting while the tap runs, heard or silent.
        pub fn reads(&self) -> u64 {
            unsafe { &*self.feed }.reads.load(Ordering::Relaxed)
        }
    }

    /// Start hearing `target` into `ring`, channels `left` and `right` (from 0).
    pub fn open(target: &Target, channels: (usize, usize), ring: Ring) -> Result<Tap, String> {
        let n = COUNT.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let description = unsafe {
            match target {
                Target::Processes(ids) => {
                    let ids: Vec<Retained<NSNumber>> = ids.iter().map(|&id| NSNumber::new_u32(id)).collect();
                    CATapDescription::initStereoMixdownOfProcesses(CATapDescription::alloc(), &NSArray::from_retained_slice(&ids))
                }
                Target::Everything => CATapDescription::initStereoGlobalTapButExcludeProcesses(CATapDescription::alloc(), &NSArray::new()),
            }
        };
        unsafe {
            description.setName(&NSString::from_str(&format!("visual[flow] {pid}.{n}")));
            description.setPrivate(true);
            description.setMuteBehavior(CATapMuteBehavior::Unmuted);
        }
        let mut tap: AudioObjectID = 0;
        check("making the tap", unsafe { AudioHardwareCreateProcessTap(Some(&description), &mut tap) })?;
        let mut made = Tap { tap, device: 0, proc_id: None, feed: std::ptr::null_mut(), rate: 48000.0, channels: 2 };
        let format: Option<AudioStreamBasicDescription> = get(tap, kAudioTapPropertyFormat);
        if let Some(f) = format {
            made.rate = f.mSampleRate as f32;
            made.channels = f.mChannelsPerFrame.max(1) as usize;
        }

        let uuid = unsafe { description.UUID() }.UUIDString();
        let sub = NSDictionary::from_retained_objects(&[&*key(kAudioSubTapUIDKey), &*key(kAudioSubTapDriftCompensationKey)], &[object(uuid), object(NSNumber::new_bool(true))]);
        let keys = [kAudioAggregateDeviceNameKey, kAudioAggregateDeviceUIDKey, kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceTapAutoStartKey, kAudioAggregateDeviceTapListKey].map(key);
        let values = [
            object(NSString::from_str("visual[flow] listening")),
            object(NSString::from_str(&format!("fm.openflow.visuals.tap.{pid}.{n}"))),
            object(NSNumber::new_bool(true)),
            object(NSNumber::new_bool(true)),
            object(NSArray::from_retained_slice(&[sub])),
        ];
        let keys: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
        let properties = NSDictionary::from_retained_objects(&keys, &values);
        // NSDictionary and CFDictionary are the same object.
        let properties: &CFDictionary = unsafe { &*(Retained::as_ptr(&properties) as *const CFDictionary) };
        check("making the tap's device", unsafe { AudioHardwareCreateAggregateDevice(properties, NonNull::from(&mut made.device)) })?;

        made.feed = Box::into_raw(Box::new(Feed { ring, channels, reads: AtomicU64::new(0) }));
        check("reading the tap", unsafe { AudioDeviceCreateIOProcID(made.device, Some(io), made.feed.cast(), NonNull::from(&mut made.proc_id)) })?;
        check("starting the tap", unsafe { AudioDeviceStart(made.device, made.proc_id) })?;
        Ok(made)
    }

    impl Drop for Tap {
        fn drop(&mut self) {
            unsafe {
                if self.proc_id.is_some() {
                    AudioDeviceStop(self.device, self.proc_id);
                    AudioDeviceDestroyIOProcID(self.device, self.proc_id);
                }
                if self.device != 0 {
                    AudioHardwareDestroyAggregateDevice(self.device);
                }
                AudioHardwareDestroyProcessTap(self.tap);
                if !self.feed.is_null() {
                    drop(Box::from_raw(self.feed));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The last `n` samples of each side of `ring`.
    fn tail(ring: &Ring, n: usize) -> (Vec<f32>, Vec<f32>) {
        let (l, r) = &*ring.lock().unwrap();
        (l.iter().skip(l.len() - n).copied().collect(), r.iter().skip(r.len() - n).copied().collect())
    }

    #[test]
    fn feeds_interleaved_and_split_buffers() {
        let ring = engine::live::ring();
        feed(&[(&[0.1, 0.2, 0.3, 0.4], 2)], (0, 1), &ring);
        assert_eq!(tail(&ring, 2), (vec![0.1, 0.3], vec![0.2, 0.4]));

        // Left from the second buffer, right from the first.
        feed(&[(&[1.0, 2.0], 1), (&[3.0, 4.0], 1)], (1, 0), &ring);
        assert_eq!(tail(&ring, 2), (vec![3.0, 4.0], vec![1.0, 2.0]));
    }

    #[test]
    fn a_missing_channel_falls_back_to_the_first_and_the_ring_stays_a_window() {
        let ring = engine::live::ring();
        let mono = vec![0.5; WINDOW + 10];
        feed(&[(&mono, 1)], (0, 3), &ring);
        let (l, r) = tail(&ring, WINDOW);
        assert_eq!(ring.lock().unwrap().0.len(), WINDOW);
        assert!(l.iter().chain(&r).all(|&s| s == 0.5));
    }

    #[test]
    fn names_daws_and_their_helpers() {
        assert_eq!(daw("com.ableton.live"), Some("Ableton Live"));
        assert_eq!(daw("com.steinberg.cubase13"), Some("Cubase"));
        assert_eq!(daw("com.spotify.client"), None);
        assert!(belongs("com.google.Chrome.helper", "com.google.Chrome"));
        assert!(belongs("com.google.Chrome", "com.google.Chrome"));
        assert!(!belongs("com.google.Chromebook", "com.google.Chrome"));
        assert_eq!(app_of("com.google.Chrome.helper.Renderer"), "com.google.Chrome");
        assert_eq!(app_of("com.spotify.client"), "com.spotify.client");
    }

    /// The spike: tap `afplay` playing a system sound, and hear it. Needs sound
    /// out and the permission to listen to other apps, so it runs on request:
    /// `cargo test -p visuals-app tap::tests::hears_a_playing_process -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn hears_a_playing_process() {
        // A few seconds of speech, played by `afplay`.
        let sound = std::env::temp_dir().join("visuals-tap-test.aiff");
        let said = std::process::Command::new("say").arg("-o").arg(&sound).args(["-r", "120", "visual flow is listening to this voice through a process tap"]).status().unwrap();
        assert!(said.success());
        let mut player = std::process::Command::new("afplay").args(["-v", "0.3"]).arg(&sound).spawn().unwrap();
        let pid = player.id() as i32;
        let found = (0..40).find_map(|_| {
            std::thread::sleep(std::time::Duration::from_millis(50));
            processes().into_iter().find(|p| p.pid == pid)
        });
        let Some(process) = found else {
            let _ = player.kill();
            panic!("afplay never showed up as a Core Audio process");
        };
        eprintln!("permission to hear other apps: {:?}", permission());
        let ring = engine::live::ring();
        let tap = open(&Target::Processes(vec![process.object]), (0, 1), ring.clone()).unwrap();
        let mut loudest = (0.0f32, 0.0f32);
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let p = engine::live::peaks(&ring);
            loudest = (loudest.0.max(p.0), loudest.1.max(p.1));
        }
        eprintln!("tap at {} Hz, {} channels, {} reads, loudest {loudest:?}", tap.rate, tap.channels, tap.reads());
        drop(tap);
        let _ = player.kill();
        let _ = player.wait();
        assert!(loudest.0 > 0.001 && loudest.1 > 0.001, "the tap heard silence: {loudest:?}");
    }
}
