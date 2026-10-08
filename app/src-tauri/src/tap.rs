//! Listening to another app's sound, or the whole system's, without a loopback
//! device. A stub for now: issue #85 puts the Core Audio process tap here
//! (macOS 14.4 and later).

/// Whether this Mac can tap an app's or the system's sound.
pub fn supported() -> bool {
    false
}
