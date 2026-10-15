# Changelog

What changed in each version of visual[flow], newest first. A release's own notes (shown on
its draft and as the update's notes in the app) are in `.github/notes/<tag>.md`;
[`docs/releasing.md`](docs/releasing.md) says how a release goes out.

## [1.0.0-rc.1] - 2026-10-15

The first release candidate of 1.0, the first public release: a MilkDrop player, not an
editor. Everything since 0.2.0 (the evaluation builds) is in it; the milestones are in
[#105](https://github.com/openflowfm/visuals/issues/105) and
[the plan](docs/milkdrop-engine.md#the-plan-03-to-10).

### Added

- Listening to a DAW, everything on the Mac, or a mic or interface through a Core Audio
  process tap (macOS 14.4 and later), with a second input mixed alongside the main one.
- 250 starter presets in the app and the full Cream of the Crop pack (9,795) as one
  download, with its index and thumbnails.
- The library: automatic groups, thumbnails and hover previews, a library map, stars,
  tags, hidden presets and each preset's own speed and sensitivity.
- Playlists as home, each with its own settings, and smart playlists.
- Live mode: in the window or full screen on a chosen display, with performance effects
  on keys, a crate, Stay on this one, and holding Esc to leave.
- Ableton Link: follows the session's tempo and bars, changes presets on the bar line,
  and the one, set and nudged.
- Camera outlines fed into the playing preset, processed on the Mac.
- Output render settings (resolution, scale, frame rate) and a quality setting.
- The first-run welcome, the photosensitivity warning, Reduce motion and Reduce
  transparency, and VoiceOver labels.
- Opt-in crash reports, written on the Mac and sent only by the user.
- Updates on two channels, release and latest, switchable in Settings.

### Changed

- The UI is built on the zen design OS, in its dark visuals theme. 1.0 is dark only; an
  Appearance setting comes in 1.1.
- The effects' settings (strobe, blackout fade, brightness, sensitivity) and whether Link
  is on are kept between launches (#295). Link used to turn on at every launch.
- With Reduce motion, the strobe pulses softly instead of blinking (#285).
- Audio inputs never swap devices by themselves, name what failed, and reopen when they're
  back (#293).

### Removed

- The preset editor from the app people get: it is a lab build (`npm run app:lab`).

[1.0.0-rc.1]: https://github.com/openflowfm/visuals/releases/tag/v1.0.0-rc.1
