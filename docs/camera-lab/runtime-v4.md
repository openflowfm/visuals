# Camera preview transport

Development-only authenticated routes; none is in the shipping binary.

- `GET /__bridge/camera/presets`: array of `{id,title,authors,thumbnail}`. Three camera presets (`camera:0`–`camera:2`) precede installed library rows. Catalog IDs are keys, never arbitrary paths. Thumbnail URLs are relative bridge routes and require the same token.
- `POST /__bridge/camera/settings`: required `speed` (0.1–3) and `persistence` (0–0.98); optional `presetId`, legacy numeric `preset`, and `resolution` (`360p`, `720p`, `1080p`). Missing resolution preserves the current size. Both renderer textures and output surface change; output headers remain authoritative. Failed shader translation returns 422.
- `POST /__bridge/camera/audio?rate=48000&gain=1`: exactly 512 or 1024 mono IEEE float32 little-endian samples, finite and within -1..1. Rate is 8000–192000 Hz, gain 0–4. Acknowledgement follows render-thread delivery. Clients keep one request in flight and send latest windows, not a backlog. PCM feeds the engine FFT; custom presets use bass, mid and treble. After 250 ms without fresh PCM the input is silence. `POST /__bridge/camera/audio/stop` clears input and audio state; camera stop also clears it. No device is opened or preference persisted by these routes.

1080p transfers 8,294,400 bytes per raw frame. It is an explicit quality choice, not a promise of 30 FPS on every machine. The browser controls microphone permission and input-device selection.
