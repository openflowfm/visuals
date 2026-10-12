# Main audio and microphone

The Audio controls select two independent inputs. Main keeps the existing app,
whole-Mac, and interface choices. Microphone adds an optional input device. Both
feed the visualizer analysis; neither is played through the speakers. Each lane
has its own channel pair and an explicit Off choice. A mono input feeds both sides.
The same hardware input cannot be selected in both lanes.

Existing `audio.json` choices become Main. Microphone starts Off. The additional
`audio-lanes.json` saves Main Off and the microphone choice. Disconnecting the mic
silences that lane and waits for that exact device; it never opens a different mic.
Main retains its existing fallback behavior. New device selections use Core Audio's
stable device ID, with name/channel matching retained for old saved choices.

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
