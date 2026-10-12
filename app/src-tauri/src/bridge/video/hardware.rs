//! Minimal retained CoreFoundation/VideoToolbox boundary. Session is confined to
//! the producer thread; callbacks own their metadata and share only locked state.
#![allow(unsafe_op_in_unsafe_fn)]
use super::*;
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicUsize, Ordering};
type Ref = *const c_void;
type Mut = *mut c_void;
#[repr(C)]
#[derive(Clone, Copy)]
struct Time {
    value: i64,
    scale: i32,
    flags: u32,
    epoch: i64,
}
impl Time {
    fn micros(value: u64) -> Self {
        Self { value: value as i64, scale: 1_000_000, flags: 1, epoch: 0 }
    }
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: Ref;
    static kCFBooleanFalse: Ref;
    static kCFTypeDictionaryKeyCallBacks: [usize; 6];
    static kCFTypeDictionaryValueCallBacks: [usize; 5];
    fn CFDictionaryCreateMutable(a: Ref, capacity: isize, keys: Ref, values: Ref) -> Mut;
    fn CFDictionarySetValue(d: Mut, key: Ref, value: Ref);
    fn CFNumberCreate(a: Ref, kind: isize, value: Ref) -> Ref;
    fn CFRelease(value: Ref);
}
#[link(name = "CoreVideo", kind = "framework")]
unsafe extern "C" {
    static kCVPixelBufferPixelFormatTypeKey: Ref;
    static kCVPixelBufferWidthKey: Ref;
    static kCVPixelBufferHeightKey: Ref;
    static kCVPixelBufferIOSurfacePropertiesKey: Ref;
    fn CVPixelBufferPoolCreatePixelBuffer(a: Ref, pool: Ref, out: *mut Ref) -> i32;
    fn CVPixelBufferLockBaseAddress(buffer: Ref, flags: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(buffer: Ref, flags: u64) -> i32;
    fn CVPixelBufferGetBaseAddress(buffer: Ref) -> Mut;
    fn CVPixelBufferGetBytesPerRow(buffer: Ref) -> usize;
}
#[link(name = "CoreMedia", kind = "framework")]
unsafe extern "C" {
    fn CMSampleBufferGetDataBuffer(sample: Ref) -> Ref;
    fn CMSampleBufferGetFormatDescription(sample: Ref) -> Ref;
    fn CMBlockBufferGetDataLength(buffer: Ref) -> usize;
    fn CMBlockBufferCopyDataBytes(buffer: Ref, offset: usize, length: usize, destination: Mut) -> i32;
    fn CMVideoFormatDescriptionGetH264ParameterSetAtIndex(description: Ref, index: usize, pointer: *mut *const u8, size: *mut usize, count: *mut usize, header: *mut i32) -> i32;
}
#[link(name = "VideoToolbox", kind = "framework")]
unsafe extern "C" {
    static kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: Ref;
    static kVTVideoEncoderSpecification_EnableLowLatencyRateControl: Ref;
    static kVTCompressionPropertyKey_RealTime: Ref;
    static kVTCompressionPropertyKey_AllowFrameReordering: Ref;
    static kVTCompressionPropertyKey_AverageBitRate: Ref;
    static kVTCompressionPropertyKey_ExpectedFrameRate: Ref;
    static kVTCompressionPropertyKey_ProfileLevel: Ref;
    static kVTProfileLevel_H264_High_AutoLevel: Ref;
    static kVTEncodeFrameOptionKey_ForceKeyFrame: Ref;
    fn VTCompressionSessionCreate(
        a: Ref,
        width: i32,
        height: i32,
        codec: u32,
        spec: Ref,
        attributes: Ref,
        allocator: Ref,
        callback: unsafe extern "C" fn(Mut, Mut, i32, u32, Ref),
        context: Mut,
        out: *mut Ref,
    ) -> i32;
    fn VTSessionSetProperty(session: Ref, key: Ref, value: Ref) -> i32;
    fn VTCompressionSessionPrepareToEncodeFrames(session: Ref) -> i32;
    fn VTCompressionSessionGetPixelBufferPool(session: Ref) -> Ref;
    fn VTCompressionSessionEncodeFrame(session: Ref, image: Ref, pts: Time, duration: Time, properties: Ref, source: Mut, flags: *mut u32) -> i32;
    fn VTCompressionSessionCompleteFrames(session: Ref, until: Time) -> i32;
    fn VTCompressionSessionInvalidate(session: Ref);
}
#[repr(C)]
struct ImageBuffer {
    data: Mut,
    height: usize,
    width: usize,
    row_bytes: usize,
}
#[link(name = "Accelerate", kind = "framework")]
unsafe extern "C" {
    fn vImagePermuteChannels_ARGB8888(source: *const ImageBuffer, destination: *const ImageBuffer, channels: *const u8, flags: u32) -> isize;
}
struct Owned(Ref);
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}
unsafe fn dictionary() -> Owned {
    Owned(CFDictionaryCreateMutable(null(), 0, &kCFTypeDictionaryKeyCallBacks as *const _ as Ref, &kCFTypeDictionaryValueCallBacks as *const _ as Ref))
}
unsafe fn integer(value: i32) -> Owned {
    Owned(CFNumberCreate(null(), 3, &value as *const _ as Ref))
}
fn check(status: i32, operation: &str) -> Result<(), String> {
    if status == 0 { Ok(()) } else { Err(format!("hardware video {operation}: {status}")) }
}
struct Context {
    shared: Arc<Shared>,
    pending: AtomicUsize,
    #[cfg(test)]
    completed: AtomicUsize,
}
struct Submission {
    sequence: u64,
    timestamp: u64,
    size: (u32, u32),
    epoch: u64,
    snapshot_ms: f64,
    started: Instant,
}
pub(super) struct Encoder {
    session: Owned,
    context: Box<Context>,
    force: Owned,
    pub size: (u32, u32),
    pub epoch: u64,
}
impl Encoder {
    pub fn new(size: (u32, u32), epoch: u64, shared: Arc<Shared>) -> Result<Self, String> {
        unsafe {
            let spec = dictionary();
            CFDictionarySetValue(spec.0 as Mut, kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder, kCFBooleanTrue);
            CFDictionarySetValue(spec.0 as Mut, kVTVideoEncoderSpecification_EnableLowLatencyRateControl, kCFBooleanTrue);
            let attributes = dictionary();
            for (key, value) in [(kCVPixelBufferPixelFormatTypeKey, u32::from_be_bytes(*b"BGRA") as i32), (kCVPixelBufferWidthKey, size.0 as i32), (kCVPixelBufferHeightKey, size.1 as i32)] {
                let value = integer(value);
                CFDictionarySetValue(attributes.0 as Mut, key, value.0);
            }
            let empty = dictionary();
            CFDictionarySetValue(attributes.0 as Mut, kCVPixelBufferIOSurfacePropertiesKey, empty.0);
            let mut context = Box::new(Context {
                shared,
                pending: AtomicUsize::new(0),
                #[cfg(test)]
                completed: AtomicUsize::new(0),
            });
            let mut session = null();
            check(
                VTCompressionSessionCreate(null(), size.0 as i32, size.1 as i32, u32::from_be_bytes(*b"avc1"), spec.0, attributes.0, null(), callback, &mut *context as *mut _ as Mut, &mut session),
                "create",
            )?;
            let force = dictionary();
            CFDictionarySetValue(force.0 as Mut, kVTEncodeFrameOptionKey_ForceKeyFrame, kCFBooleanTrue);
            let encoder = Self { session: Owned(session), context, force, size, epoch };
            for (key, value) in [
                (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue),
                (kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse),
                (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel),
            ] {
                check(VTSessionSetProperty(session, key, value), "property")?;
            }
            for (key, value) in [(kVTCompressionPropertyKey_AverageBitRate, 80_000_000), (kVTCompressionPropertyKey_ExpectedFrameRate, 60)] {
                let number = integer(value);
                check(VTSessionSetProperty(session, key, number.0), "rate")?;
            }
            check(VTCompressionSessionPrepareToEncodeFrames(session), "prepare")?;
            Ok(encoder)
        }
    }
    pub fn pending(&self) -> usize {
        self.context.pending.load(Ordering::Acquire)
    }
    pub fn submit(&mut self, rgba: Vec<u8>, sequence: u64, timestamp: u64, snapshot_ms: f64) -> Result<(), String> {
        unsafe {
            if self.pending() >= 2 {
                return Ok(());
            }
            if rgba.len() != self.size.0 as usize * self.size.1 as usize * 4 {
                return Err("invalid camera frame length".into());
            }
            let started = Instant::now();
            let pool = VTCompressionSessionGetPixelBufferPool(self.session.0);
            if pool.is_null() {
                return Err("hardware video pixel pool unavailable".into());
            }
            let mut pixel = null();
            check(CVPixelBufferPoolCreatePixelBuffer(null(), pool, &mut pixel), "pixel buffer")?;
            let pixel = Owned(pixel);
            check(CVPixelBufferLockBaseAddress(pixel.0, 0), "pixel lock")?;
            let destination = CVPixelBufferGetBaseAddress(pixel.0) as *mut u8;
            let stride = CVPixelBufferGetBytesPerRow(pixel.0);
            if destination.is_null() || stride < self.size.0 as usize * 4 {
                CVPixelBufferUnlockBaseAddress(pixel.0, 0);
                return Err("invalid hardware pixel buffer".into());
            }
            let source = ImageBuffer { data: rgba.as_ptr() as Mut, height: self.size.1 as usize, width: self.size.0 as usize, row_bytes: self.size.0 as usize * 4 };
            let target = ImageBuffer { data: destination as Mut, height: self.size.1 as usize, width: self.size.0 as usize, row_bytes: stride };
            let converted = vImagePermuteChannels_ARGB8888(&source, &target, [2, 1, 0, 3].as_ptr(), 0);
            if converted != 0 {
                CVPixelBufferUnlockBaseAddress(pixel.0, 0);
                return Err(format!("hardware video pixel conversion: {converted}"));
            }
            check(CVPixelBufferUnlockBaseAddress(pixel.0, 0), "pixel unlock")?;
            let submission = Box::into_raw(Box::new(Submission { sequence, timestamp, size: self.size, epoch: self.epoch, snapshot_ms, started }));
            self.context.pending.fetch_add(1, Ordering::AcqRel);
            let result = VTCompressionSessionEncodeFrame(self.session.0, pixel.0, Time::micros(timestamp), Time::micros(16_667), self.force.0, submission as Mut, null_mut());
            if result != 0 {
                self.context.pending.fetch_sub(1, Ordering::AcqRel);
                drop(Box::from_raw(submission));
            }
            check(result, "encode")
        }
    }
}
impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe {
            // Completion synchronously drains callbacks before context/session destruction.
            VTCompressionSessionCompleteFrames(self.session.0, Time { value: 0, scale: 0, flags: 0, epoch: 0 });
            VTCompressionSessionInvalidate(self.session.0);
        }
    }
}
unsafe extern "C" fn callback(context: Mut, source: Mut, status: i32, _flags: u32, sample: Ref) {
    if context.is_null() || source.is_null() {
        return;
    }
    let context = &*(context as *const Context);
    let submission = Box::from_raw(source as *mut Submission);
    // Never unwind across the system callback boundary.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        check(status, "callback")?;
        if sample.is_null() {
            return Err("hardware video dropped a frame".into());
        }
        let (bytes, codec) = annex_b(sample)?;
        Ok::<_, String>(Arc::new(Frame {
            sequence: submission.sequence,
            timestamp: submission.timestamp,
            size: submission.size,
            snapshot_ms: submission.snapshot_ms,
            encode_ms: submission.started.elapsed().as_secs_f64() * 1000.0,
            codec,
            bytes,
        }))
    }))
    .unwrap_or_else(|_| Err("hardware video callback failed".into()));
    #[cfg(test)]
    if result.is_ok() {
        context.completed.fetch_add(1, Ordering::Relaxed);
    }
    if let Ok(mut state) = context.shared.state.lock() {
        if state.enabled && state.epoch == submission.epoch {
            match result {
                Ok(frame) => {
                    if state.latest.as_ref().is_none_or(|old| frame.sequence > old.sequence) {
                        state.latest = Some(frame);
                    }
                }
                Err(error) => state.error = Some(error),
            }
            context.shared.changed.notify_all();
        }
    }
    context.pending.fetch_sub(1, Ordering::AcqRel);
}
unsafe fn annex_b(sample: Ref) -> Result<(Vec<u8>, String), String> {
    let format = CMSampleBufferGetFormatDescription(sample);
    let mut bytes = Vec::new();
    let mut codec = String::new();
    let mut header = 0;
    for index in 0..2 {
        let mut pointer = null();
        let mut length = 0;
        let mut count = 0;
        check(CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, index, &mut pointer, &mut length, &mut count, &mut header), "parameter set")?;
        if pointer.is_null() || length == 0 || length > 4096 {
            return Err("invalid H264 parameter set".into());
        }
        let data = std::slice::from_raw_parts(pointer, length);
        if index == 0 {
            if length < 4 {
                return Err("short H264 SPS".into());
            }
            codec = format!("avc1.{:02x}{:02x}{:02x}", data[1], data[2], data[3]);
        }
        bytes.extend_from_slice(&[0, 0, 0, 1]);
        bytes.extend_from_slice(data);
    }
    let block = CMSampleBufferGetDataBuffer(sample);
    if block.is_null() {
        return Err("missing H264 buffer".into());
    }
    let length = CMBlockBufferGetDataLength(block);
    if length > 16 * 1024 * 1024 {
        return Err("oversized H264 frame".into());
    }
    let mut avcc = vec![0; length];
    check(CMBlockBufferCopyDataBytes(block, 0, length, avcc.as_mut_ptr() as Mut), "copy")?;
    append_nals(&avcc, header as usize, &mut bytes)?;
    Ok((bytes, codec))
}
fn append_nals(avcc: &[u8], header: usize, out: &mut Vec<u8>) -> Result<(), String> {
    if !(1..=4).contains(&header) {
        return Err("invalid H264 NAL length".into());
    }
    let mut at = 0;
    let mut key = false;
    while at < avcc.len() {
        let end = at.checked_add(header).filter(|end| *end <= avcc.len()).ok_or("truncated H264 length")?;
        let length = avcc[at..end].iter().fold(0usize, |n, b| (n << 8) | *b as usize);
        at = end;
        let end = at.checked_add(length).filter(|end| *end <= avcc.len()).ok_or("truncated H264 NAL")?;
        if length == 0 {
            return Err("empty H264 NAL".into());
        }
        key |= avcc[at] & 31 == 5;
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&avcc[at..end]);
        at = end;
    }
    if !key {
        return Err("hardware encoder did not return an independent IDR frame".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "manual real-time GPU/encoder throughput measurement"]
    fn paced_gpu_snapshot_hardware_throughput() {
        let video = Video::default();
        video.0.state.lock().unwrap().enabled = true;
        let size = (1920, 1080);
        let (device, queue) = engine::render::headless().unwrap();
        let mut renderer = engine::render::Renderer::new(device, queue, size.0, size.1);
        renderer.load(include_str!("../mirror-cathedral.milk"), 1).unwrap();
        let input: Vec<u8> = (0..640 * 360).flat_map(|i| [(i % 251) as u8, ((i / 640) % 251) as u8, 160, 255]).collect();
        renderer.set_camera_frame(640, 360, &input, 0.15).unwrap();
        let snapshot = crate::bench::CameraSnapshot::new(&renderer, size);
        let mut encoder = Encoder::new(size, 0, video.0.clone()).unwrap();
        let mut audio = engine::audio::Audio::default();
        let origin = Instant::now();
        for sequence in 1..=12 {
            renderer.render(&mut audio, 1.0 / 60.0);
            let (_, _, rgba) = snapshot.read(&mut renderer).unwrap();
            encoder.submit(rgba, sequence, origin.elapsed().as_micros() as u64, 0.0).unwrap();
            unsafe {
                check(VTCompressionSessionCompleteFrames(encoder.session.0, Time { value: 0, scale: 0, flags: 0, epoch: 0 }), "warmup").unwrap();
            }
        }
        encoder.context.completed.store(0, Ordering::Relaxed);
        let clock = Instant::now();
        let mut cadence = Cadence::new(clock);
        let mut skipped = 0;
        let mut snapshots = Vec::new();
        let mut submit_times = Vec::new();
        for sequence in 13..=192 {
            let start = Instant::now();
            renderer.render(&mut audio, 1.0 / 60.0);
            if encoder.pending() < 2 {
                let (_, _, rgba) = snapshot.read(&mut renderer).unwrap();
                let snapshot_ms = start.elapsed().as_secs_f64() * 1000.0;
                let submit = Instant::now();
                encoder.submit(rgba, sequence, origin.elapsed().as_micros() as u64, snapshot_ms).unwrap();
                snapshots.push(snapshot_ms);
                submit_times.push(submit.elapsed().as_secs_f64() * 1000.0);
            } else {
                skipped += 1;
            }
            std::thread::sleep(cadence.delay(Instant::now()));
        }
        unsafe {
            check(VTCompressionSessionCompleteFrames(encoder.session.0, Time { value: 0, scale: 0, flags: 0, epoch: 0 }), "drain").unwrap();
        }
        let completed = encoder.context.completed.load(Ordering::Relaxed);
        let elapsed = clock.elapsed().as_secs_f64();
        snapshots.sort_by(f64::total_cmp);
        submit_times.sort_by(f64::total_cmp);
        eprintln!(
            "1080p native paced harness: {completed}/180 callbacks, {skipped} pending skips, {elapsed:.3}s, {:.2} unique fps, snapshot+render median {:.2}ms p95 {:.2}ms, submit median {:.2}ms",
            completed as f64 / elapsed,
            snapshots[snapshots.len() / 2],
            snapshots[snapshots.len() * 95 / 100],
            submit_times[submit_times.len() / 2]
        );
        assert!(video.0.state.lock().unwrap().error.is_none());
        assert!(completed > 0);
    }

    #[test]
    fn hardware_frames_are_independent_bounded_and_discarded_after_stop() {
        let video = Video::default();
        {
            video.0.state.lock().unwrap().enabled = true;
        }
        let mut times = Vec::new();
        let mut sequence = 0;
        for size in [(1280, 720), (1920, 1080)] {
            let mut encoder = Encoder::new(size, 0, video.0.clone()).expect("hardware encoder");
            let rgba: Vec<u8> = (0..size.0 as usize * size.1 as usize).flat_map(|i| [(i % 251) as u8, ((i / size.0 as usize) % 251) as u8, 160, 255]).collect();
            for _ in 0..12 {
                sequence += 1;
                encoder.submit(rgba.clone(), sequence, sequence * 16_667, 1.0).unwrap();
                assert!(encoder.pending() <= 2);
                let deadline = Instant::now() + Duration::from_secs(3);
                let mut state = video.0.state.lock().unwrap();
                while state.latest.as_ref().is_none_or(|f| f.sequence != sequence) && state.error.is_none() {
                    assert!(Instant::now() < deadline, "encoder callback timeout");
                    state = video.0.changed.wait_timeout(state, Duration::from_millis(100)).unwrap().0;
                }
                assert!(state.error.is_none(), "{:?}", state.error);
                let frame = state.latest.as_ref().unwrap();
                assert_eq!(frame.size, size);
                assert!(frame.codec.starts_with("avc1.64"));
                assert_eq!(&frame.bytes[..4], &[0, 0, 0, 1]);
                assert_eq!(frame.bytes[4] & 31, 7);
                times.push(frame.encode_ms);
            }
            // Stop while a submission is pending: callback cannot republish it.
            encoder.submit(rgba, sequence + 1, (sequence + 1) * 16_667, 1.0).unwrap();
            video.stop();
            drop(encoder);
            assert!(video.0.state.lock().unwrap().latest.is_none());
            {
                let mut state = video.0.state.lock().unwrap();
                state.enabled = true;
                state.epoch = 0;
            }
            sequence += 1;
        }
        times.sort_by(f64::total_cmp);
        eprintln!("hardware dev-build upload+encode median {:.2}ms p95 {:.2}ms", times[times.len() / 2], times[(times.len() * 95 / 100).min(times.len() - 1)]);
    }

    #[test]
    fn annex_b_rejects_truncated_or_dependent_frames() {
        let mut out = Vec::new();
        assert!(append_nals(&[0, 0, 0, 2, 0x65, 9], 4, &mut out).is_ok());
        assert_eq!(out, [0, 0, 0, 1, 0x65, 9]);
        assert!(append_nals(&[0, 0, 0, 4, 0x65], 4, &mut vec![]).is_err());
        assert!(append_nals(&[0, 0, 0, 1, 0x41], 4, &mut vec![]).is_err());
        assert!(append_nals(&[], 0, &mut vec![]).is_err());
    }
}
