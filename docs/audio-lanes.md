# Main audio and microphone

The Audio controls select two independent inputs. Main keeps the existing app,
whole-Mac, and interface choices. Microphone adds an optional input device. Both
feed the visualizer analysis; neither is played through the speakers. Each lane
has its own channel pair and an explicit Off choice. Any input can be either lane,
whatever its channel count: a device opens in the format it runs at now (its own
channels and current rate; `engine::live::input_config`), or, when it can't report
one, the best of its supported formats. A mono input feeds both sides.
The same hardware input cannot be selected in both lanes.

Existing `audio.json` choices become Main. Microphone starts Off. The additional
`audio-lanes.json` saves Main Off and the microphone choice. An input device in
either lane is never swapped for another one: when it disconnects, or doesn't open
at startup, the lane goes quiet, says which device and why (`problem` in the lane's
status), and opens that exact device again when it comes back. An app that quits
still falls back to the whole Mac when this Mac can tap it. New device selections
use Core Audio's stable device ID, with name/channel matching retained for old
saved choices.

Device and process-tap callbacks write independent bounded queues with nonblocking
locks. One mixer clock linearly resamples each queue to 48 kHz, adds corresponding
stereo samples, and clamps the sum to [-1, 1]. A single source keeps its gain;
nonfinite samples become silence. A lane with no new data for 100 ms drops its
backlog and goes silent. This is visualizer analysis routing, not a production
recording mixer or a high-quality sample-rate conversion/export path.

Changing one lane opens its replacement before releasing the previous input, so
an acquisition failure preserves the working source. Selecting Off releases the
stream. The test sound pauses both inputs and polling, then restores the saved
choices. The debug/headless Camera screenshot fixture prohibits acquisition of
both lanes, including their polling and reconnect paths.

Validation uses synthetic callback buffers and fake devices; physical device,
macOS permission, and simultaneous live-input acceptance require a user session.

## Connection stalls

A native acquisition has a deadline across source lookup, input-format query,
Core Audio stream construction and stream start: 20 seconds for a process tap,
15 for an input device (a webcam's or an iPhone's microphone can take seconds to
wake). On expiry the command returns an error naming the source and its last
phase, releases the routing transaction, and
leaves the previous main/microphone choices running. A late stream is disposed on
the acquisition worker; it cannot replace the selected lane. Cancellation is
checked between native stages, including before starting a newly built stream.

Only one hardware acquisition may be outstanding. Core Audio calls themselves
cannot be forcibly interrupted: if a driver or permission call remains blocked,
retries report that pending native connection instead of creating more workers.
Finish any macOS permission prompt, then retry; restarting the app is the recovery
if the native call never returns. Standard error includes each connection phase
(`audio connection: ...`) for diagnosis. This bounds the hang and preserves the
working source; it does not establish which driver/permission call caused the
reported live-device stall. Physical-device reproduction remains unverified.
