import './style.css';
import { TOKEN_KEY, tokenFrom } from '../bridge';
import { TemporalContours } from './temporal-contours';
import { Contours, rawFrameSize } from './contours';
import { contourPacket } from './contour-packet';
import { ColorSignal } from './color-signal';
import { closeVideoFrame, videoResourceSummary } from './video-resources';
import { VideoPackets } from './video-packets';
import { H264Decoder } from './h264-decoder';
import { videoCapability } from './video-capability';
import { OutputMeter } from './output-meter';
import { CameraAudio } from './audio-input';
import { LatestSelection, stepPreset, type CameraPreset } from './preset-browser';
import { traceContours, drawContourPaths, type ContourPath } from './curve-contours';
import { PersonMask } from './person-mask';
import demoPhotoUrl from './person-assets/astronaut.png?url';

const root = document.querySelector<HTMLDivElement>('#camera-app')!;
root.innerHTML = `
<header><a class="wordmark" href="#">open<span>flow</span></a><div class="edition">EXPERIMENT 001 <span>↗ LIVE CAMERA LAB</span></div><div class="local"><i></i> LOCAL SIGNAL</div></header>
<main><div class="intro"><div><p class="eyebrow">YOUR FACE. THE FEEDBACK LOOP.</p><h1>Camera <em>possession.</em></h1></div><p class="lede">Become a beautiful signal problem.<br>Feed yourself into the MilkDrop machine.</p></div>
<section class="instrument" aria-label="Camera instrument"><div class="stage"><canvas id="output" width="960" height="540" aria-label="Processed native engine output"></canvas><div class="stage-top"><span id="signal">NO INPUT</span><span id="rate">NATIVE MILKDROP / METAL</span></div><div class="stage-metrics" id="performance-details" hidden><p id="sustained-rate">Waiting for native frame IDs…</p><p id="timings"></p><p id="video-resources">Resource diagnostics inactive</p><p id="video-capability" data-codec="">Checking local H.264 decoder…</p></div><div id="welcome"><div class="orb">◎</div><h2>Something wants to see you.</h2><p>Try the test subject first. Then become it.</p><button id="demo-center">Run demo <span>↗</span></button></div><div class="preset-dock"><button id="previous-preset" aria-label="Previous preset">←</button><button id="browse-presets" aria-expanded="false">Chromatic vortex ▴</button><button id="next-preset" aria-label="Next preset">→</button><button id="random-preset" aria-label="Random preset">⤨</button></div><section id="preset-browser" aria-label="Preset browser" hidden><div class="browser-head"><input id="preset-search" type="search" aria-label="Search presets" placeholder="Find a hallucination…"/><button id="close-presets" aria-label="Close preset browser">×</button></div><p id="preset-count"></p><div id="preset-list"></div><div class="browser-pages"><button id="preset-page-back">Previous 60</button><button id="preset-page-next">Next 60</button></div><p id="preset-error" role="status"></p></section><div class="stage-bottom"><span id="status" role="status" aria-live="polite">Ready when you are.</span><button id="fullscreen" aria-label="Full screen output">⛶</button></div></div>
<aside><div class="section-title">01 <span>CHOOSE YOUR AFFLICTION</span></div><div class="presets"><button data-preset="0" class="selected"><b>Chromatic vortex</b><span>Spiral into a spectral wormhole</span><i>01</i></button><button data-preset="1"><b>Prism cult</b><span>Sixfold stained-glass hallucination</span><i>02</i></button><button data-preset="2"><b>Acid tide</b><span>Liquid ribbons and chromatic rupture</span><i>03</i></button></div>
<div class="section-title">02 <span>LOSE YOUR COMPOSURE</span></div>
<label class="knob"><span>Clean outline <output id="recognition-value">0%</output></span><input id="recognition" type="range" min="0" max="100" value="0"/><small>Adds an undistorted foreground outline</small></label>
<label class="knob"><span>Color <output id="color-value">100%</output></span><input id="color" type="range" min="0" max="100" value="100"/><small>Silver → Full spectrum</small></label>
<label class="knob"><span><span id="feed-label">Edge feed</span> <output id="mix-value">30%</output></span><input id="mix" type="range" min="0" max="100" value="30"/><small>Sparse ink → Dense ink</small></label>
<label class="knob"><span>Afterimage <output id="persistence-value">65%</output></span><input id="persistence" type="range" min="0" max="98" value="65"/><small>Let your past selves linger</small></label>
<label class="knob"><span>Speed <output id="speed-value">0.4×</output></span><input id="speed" type="range" min="10" max="300" value="40"/><small>Slow hypnosis → Full possession</small></label>
<label class="knob"><span>Output resolution</span><select id="resolution" aria-label="Output resolution"><option value="720p" selected>720p · HD</option><option value="1080p">1080p · Full HD</option><option value="360p">360p · Faster</option></select></label><label class="knob"><span>Output transport</span><select id="output-transport" aria-label="Output transport"><option value="auto" selected>Auto · hardware H.264</option><option value="raw">Raw RGBA · comparison</option></select><small id="transport-status">Checking local decoder…</small></label><label class="mirror"><input id="show-timings" type="checkbox"/> Show timing breakdown</label><label class="mirror"><input id="mirror" type="checkbox" checked/> Mirror source <span>↔</span></label><button id="rescue">Bring my face back <span>↶</span></button></aside></section>
<section class="input-tools" aria-label="Source preparation"><div class="input-preview"><canvas id="prepared" width="320" height="180" aria-label="Prepared input sent to feedback"></canvas><span id="input-cost">INPUT TO THE LOOP</span></div><div class="input-choice"><p class="eyebrow">DISTILL THE SIGNAL</p><div class="source-modes"><button id="contour-mode" class="selected" aria-pressed="true">Contours</button><button id="raw-mode" aria-pressed="false">Raw camera</button></div><label class="person-choice"><input id="person-only" type="checkbox" checked/> Person only</label><p id="mask-status" role="status">Local subject isolation for camera input.</p></div><label class="knob"><span>Edge steadiness <output id="steadiness-value">65%</output></span><input id="steadiness" type="range" min="0" max="100" value="65"/><small>Immediate → Calm small edge jitter</small></label><label class="knob"><span>Curve smoothing <output id="smoothing-value">65%</output></span><input id="smoothing" type="range" min="0" max="100" value="65"/><small>Traced strokes → Flowing curves</small></label><label class="knob"><span>Edge detail <output id="detail-value">45%</output></span><input id="detail" type="range" min="0" max="100" value="45"/><small>Soft silhouette → Fine features</small></label><label class="knob"><span>Noise cutoff <output id="threshold-value">12</output></span><input id="threshold" type="range" min="1" max="60" value="12"/><small>Raise to remove room texture</small></label></section><div class="transport"><div><button id="camera" class="primary">Start camera <span>↗</span></button><button id="demo">Run demo</button><button id="stop" disabled>Stop</button></div><p id="source-info">No camera or microphone access until you ask.</p></div>
<section class="audio-tools" aria-label="Sound reaction"><button id="audio-toggle">Enable audio</button><select id="audio-device" aria-label="Audio input"><option value="">Default microphone / interface</option></select><label class="knob"><span>Sensitivity <output id="gain-value">1.0×</output></span><input id="gain" type="range" min="0" max="400" value="100"/></label><meter id="audio-meter" min="0" max="1" value="0" aria-label="Audio input level"></meter><span id="audio-status" role="status">Audio off</span></section><footer><span>One person → spectral feedback + crisp identity</span><span>Flashing & moving imagery. Start gently.</span></footer><p class="credits" id="credits"></p></main>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const output = $<HTMLCanvasElement>('output');
const ctx = output.getContext('2d', { alpha: false })!;
const input = document.createElement('canvas');
const WIDTH = 320,
  HEIGHT = 180,
  PREPARATION_MS = 1000 / 30;
input.width = WIDTH;
input.height = HEIGHT;
const contours = new Contours(WIDTH, HEIGHT);
const temporalContours = new TemporalContours(WIDTH, HEIGHT);
const colorSignal = new ColorSignal(WIDTH, HEIGHT);
const identity = document.createElement('canvas');
identity.id = 'identity-source';
identity.width = WIDTH;
identity.height = HEIGHT;
const identityContext = identity.getContext('2d')!;
let identityAt = -Infinity;
let identityPaths: ContourPath[] = [];
const curveCanvas = document.createElement('canvas');
curveCanvas.width = WIDTH;
curveCanvas.height = HEIGHT;
const curveContext = curveCanvas.getContext('2d', { willReadFrequently: true })!;
function clearIdentity() {
  identityAt = -Infinity;
  identityPaths = [];
  identityContext.clearRect(0, 0, WIDTH, HEIGHT);
}
const prepared = $<HTMLCanvasElement>('prepared');
const preparedContext = prepared.getContext('2d')!;
let useContours = true;
let personMask: PersonMask | null = null;
let preparationMs = 0;
let captureFrames = 0,
  preparationTotal = 0,
  uploadTotal = 0;
let fetchTotal = 0,
  bodyTotal = 0,
  composeTotal = 0;
let spectrum: CanvasGradient | null = null;
let spectrumKey = '';
let supportedVideoCodec: string | null = null;
let outputDecoder: H264Decoder | null = null;
let encodedPackets: VideoPackets | null = null;
function drainVideoPackets() {
  const packets = encodedPackets;
  encodedPackets = null;
  return packets?.dispose() ?? Promise.resolve();
}
let videoFailed = false;
let resourcesAt = -Infinity;
function showVideoResources(force = false) {
  if (force || ($<HTMLInputElement>('show-timings').checked && performance.now() - resourcesAt >= 1000)) {
    $('video-resources').textContent = videoResourceSummary();
    resourcesAt = performance.now();
  }
}
const g = input.getContext('2d', { willReadFrequently: true })!;
const demoPhoto = new Image();
demoPhoto.src = demoPhotoUrl;
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;
let token: string | null = null;
try {
  token = tokenFrom(location.search, sessionStorage.getItem(TOKEN_KEY));
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
} catch {
  token = tokenFrom(location.search, null);
}
const authors = ['Chromatic vortex', 'Prism cult', 'Acid tide'];
let presetId = 'camera:0';
let acceptedPresetId = presetId;
let presets: CameraPreset[] = authors.map((title, i) => ({ id: `camera:${i}`, title, authors: ['OpenFlow'], thumbnail: null }));
const presetSelections = new LatestSelection();
let mode: 'demo' | 'camera' | null = null;
let stream: MediaStream | null = null;
let generation = 0;
let posting: Promise<void> = Promise.resolve();
let reading: Promise<void> = Promise.resolve();
let settingsChain: Promise<void> = Promise.resolve();
let lifecycle: Promise<void> = Promise.resolve();
function ordered(action: () => Promise<void>) {
  lifecycle = lifecycle.catch(() => {}).then(action);
  return lifecycle;
}
let frames = 0;
let rateAt = performance.now();
let rescueUntil = 0;
const value = (id: string) => Number($<HTMLInputElement>(id).value);
const status = (s: string) => {
  $('status').textContent = s;
};
function path(route: string) {
  if (!token) throw new Error('Open the camera URL with the token printed by npm run dev.');
  return `/__bridge/${route}${route.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
async function post(route: string, body?: BodyInit) {
  const r = await fetch(path(route), { method: 'POST', body });
  if (!r.ok) throw new Error(r.status === 403 ? 'Bridge token expired. Open the new launcher URL.' : `Engine: ${await r.text()}`);
}
function settings(load = false) {
  settingsChain = settingsChain
    .catch(() => {})
    .then(() => {
      // Resolve the accepted preset only after prior native selections have settled.
      const body = JSON.stringify({
        presetId: load ? acceptedPresetId : undefined,
        resolution: $<HTMLSelectElement>('resolution').value,
        speed: value('speed') / 100,
        persistence: value('persistence') / 100,
      });
      return post('camera/settings', body);
    });
  return settingsChain;
}
function drawDemo(t: number) {
  // Public-domain NASA photo: low-contrast face, clothing and textured room.
  // It takes the exact same person-mask + edge path as the live camera.
  g.fillStyle = '#6f706a';
  g.fillRect(0, 0, WIDTH, HEIGHT);
  const size = HEIGHT * 1.25;
  g.drawImage(demoPhoto, (WIDTH - size) / 2 + Math.sin(t * 0.5) * 8, -8 + Math.cos(t * 0.6) * 3, size, size);
}
function renderInput() {
  g.save();
  if ($<HTMLInputElement>('mirror').checked) {
    g.translate(WIDTH, 0);
    g.scale(-1, 1);
  }
  if (mode === 'demo') drawDemo(performance.now() / 1000);
  else {
    const scale = Math.max(WIDTH / video.videoWidth, HEIGHT / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    g.drawImage(video, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
  }
  g.restore();
}
async function capture(id: number) {
  while (id === generation && mode) {
    const start = performance.now();
    try {
      renderInput();
      const isolate = $<HTMLInputElement>('person-only').checked;
      if (isolate && !personMask) preparePersonMask();
      if (isolate) personMask?.update(input);
      const mask = isolate ? personMask?.current() : null;
      if (isolate && mask) $('mask-status').textContent = 'Person mask active · background removed locally.';
      if (isolate && !mask) {
        clearIdentity();
        temporalContours.reset();
        if (personMask?.status === 'ready') $('mask-status').textContent = 'Waiting for a fresh person mask…';
        await new Promise((r) => setTimeout(r, PREPARATION_MS));
        continue;
      }
      const mix = performance.now() < rescueUntil ? 0.8 : value('mix') / 100;
      const filterStarted = performance.now();
      const source = g.getImageData(0, 0, WIDTH, HEIGHT).data;
      let data: Uint8ClampedArray;
      let paths: ContourPath[] = [];
      if (useContours) {
        const edges = contours.process(source, value('detail'), value('threshold'), mask ?? undefined);
        paths = temporalContours.update(traceContours(edges, WIDTH, HEIGHT, value('smoothing')), performance.now(), value('steadiness'));
        curveContext.fillStyle = '#000';
        curveContext.fillRect(0, 0, WIDTH, HEIGHT);
        drawContourPaths(curveContext, paths, { scaleX: 1, scaleY: 1, lineWidth: 1.05, strokeStyle: '#fff' });
        const smoothEdges = curveContext.getImageData(0, 0, WIDTH, HEIGHT).data;
        data = colorSignal.prepare(smoothEdges, source, mask ? contours.foreground : null, value('color'), performance.now() / 1000);
      } else data = mask ? contours.cutout(source, mask) : source;
      preparedContext.putImageData(new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), WIDTH, HEIGHT), 0, 0);
      preparationMs = performance.now() - filterStarted;
      const uploadStarted = performance.now();
      posting = useContours
        ? post('camera/contours', JSON.stringify(contourPacket(paths, WIDTH, HEIGHT, mix, (x, y) => colorSignal.strokeColor(x, y, source))))
        : post(`camera/frame?w=${WIDTH}&h=${HEIGHT}&mix=${mix}`, data.buffer as ArrayBuffer);
      await posting;
      if (id === generation) {
        captureFrames++;
        preparationTotal += preparationMs;
        uploadTotal += performance.now() - uploadStarted;
      }
      // Commit the exact source used for the successful upload. A reset may have
      // happened while the request was in flight; never revive its old identity.
      if (id === generation && useContours && (!isolate || personMask?.current())) {
        identityContext.putImageData(new ImageData(colorSignal.identity, WIDTH, HEIGHT), 0, 0);
        identityPaths = paths;
        identityAt = mask?.capturedAt ?? start;
      }
    } catch (e) {
      if (id === generation) {
        await stop();
        status(String(e));
      }
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, PREPARATION_MS - (performance.now() - start))));
  }
}
async function paint(id: number) {
  const meter = new OutputMeter(performance.now());
  let measuredSize = '';
  let afterSequence = '0';
  let packetWaitTotal = 0;
  let decodeTotal = 0,
    encodeTotal = 0,
    encodeCount = 0;
  let snapshotTotal = 0,
    snapshotCount = 0;
  let nextOutputAt = performance.now();
  while (id === generation && mode) {
    // A deadline avoids quantizing a slightly late native response down to 30 Hz.
    // One request remains in flight; missed deadlines never accumulate a queue.
    const wait = nextOutputAt - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nextOutputAt = Math.max(nextOutputAt + 1000 / 60, performance.now());
    if (id !== generation || !mode) return;
    const start = performance.now();
    try {
      reading = (async () => {
        const encoded = $<HTMLSelectElement>('output-transport').value === 'auto' && supportedVideoCodec !== null && !videoFailed;
        if (!encoded && outputDecoder) {
          outputDecoder.dispose();
          outputDecoder = null;
        }
        let r: Response, buffer: ArrayBuffer, fetchMs: number, bodyMs: number;
        if (encoded) {
          encodedPackets ??= new VideoPackets((after) => path(`camera/video?after=${after}`));
          const packet = await encodedPackets.take(afterSequence);
          r = packet.response;
          buffer = packet.buffer;
          fetchMs = packet.fetchMs;
          bodyMs = packet.bodyMs;
        } else {
          await drainVideoPackets();
          r = await fetch(path('camera/output'), { cache: 'no-store' });
          const headersAt = performance.now();
          buffer = await r.arrayBuffer();
          fetchMs = headersAt - start;
          bodyMs = performance.now() - headersAt;
        }
        const packetWaitMs = performance.now() - start;
        if (id !== generation) return;
        if (encoded && r.status === 204) return;
        if (encoded && r.status !== 200) {
          videoFailed = true;
          outputDecoder?.dispose();
          outputDecoder = null;
          await drainVideoPackets();
          $('transport-status').textContent = `Raw fallback · video ${r.status}: ${new TextDecoder().decode(buffer)}`;
          return;
        }
        if (r.status !== 200) throw new Error(`Output unavailable (${r.status})`);
        const [width, height] = rawFrameSize(r.headers, encoded ? Number(r.headers.get('X-Frame-Width')) * Number(r.headers.get('X-Frame-Height')) * 4 : buffer.byteLength);
        if (id !== generation) return;
        let decoded: VideoFrame | null = null;
        let decodingMs = 0;
        if (encoded) {
          const decodingAt = performance.now();
          try {
            outputDecoder ??= new H264Decoder();
            const timestampHeader = r.headers.get('X-Frame-Timestamp');
            const timestamp = timestampHeader === null ? NaN : Number(timestampHeader);
            if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !buffer.byteLength) throw new Error('Invalid encoded frame metadata');
            const sequence = r.headers.get('X-Frame-Sequence');
            if (!sequence || !/^\d+$/.test(sequence)) throw new Error('Invalid encoded frame sequence');
            if ($<HTMLSelectElement>('output-transport').value === 'auto') encodedPackets?.prefetch(sequence);
            decoded = await outputDecoder.decode(buffer, r.headers.get('X-Video-Codec') ?? supportedVideoCodec!, width, height, timestamp);
            if (decoded.displayWidth !== width || decoded.displayHeight !== height) throw new Error('Decoded frame dimensions do not match native output');
            decodingMs = performance.now() - decodingAt;
          } catch (error) {
            closeVideoFrame(decoded);
            outputDecoder?.dispose();
            outputDecoder = null;
            await drainVideoPackets();
            if (id === generation) {
              videoFailed = true;
              $('transport-status').textContent = `Raw fallback · ${String(error)}`;
            }
            return;
          }
        }
        if (id !== generation) {
          closeVideoFrame(decoded);
          return;
        }
        const composingAt = performance.now();
        try {
          if (id === generation) {
            const size = `${width}×${height}:${acceptedPresetId}:${encoded ? 'h264' : 'raw'}`;
            if (size !== measuredSize) {
              meter.reset(performance.now());
              measuredSize = size;
              $('rate').textContent = `WARMING UP / ${width}×${height}`;
              $('sustained-rate').textContent = 'Warming up · collecting a meaningful frame sample';
            }
            const snapshotHeader = r.headers.get('X-Snapshot-Ms');
            const snapshotMs = snapshotHeader === null ? NaN : Number(snapshotHeader);
            if (Number.isFinite(snapshotMs) && snapshotMs >= 0) {
              snapshotTotal += snapshotMs;
              snapshotCount++;
            }
            const image = decoded ? null : new ImageData(new Uint8ClampedArray(buffer), width, height);
            if (output.width !== width || output.height !== height) {
              output.width = width;
              output.height = height;
            }
            if (decoded) {
              // Fully replace the opaque video surface before identity compositing.
              ctx.clearRect(0, 0, width, height);
              ctx.drawImage(decoded, 0, 0, width, height);
            } else ctx.putImageData(image!, 0, 0);
            if (performance.now() - identityAt <= 250 && useContours) {
              ctx.save();
              ctx.globalAlpha = performance.now() < rescueUntil ? 1 : value('recognition') / 100;
              ctx.imageSmoothingEnabled = true;
              ctx.drawImage(identity, 0, 0, width, height);
              const saturation = value('color');
              const key = `${width}:${height}:${saturation}`;
              if (!spectrum || spectrumKey !== key) {
                spectrum = ctx.createLinearGradient(0, 0, width, height);
                spectrum.addColorStop(0, `hsl(170 ${saturation}% 85%)`);
                spectrum.addColorStop(0.5, `hsl(290 ${saturation}% 85%)`);
                spectrum.addColorStop(1, `hsl(40 ${saturation}% 85%)`);
                spectrumKey = key;
              }
              drawContourPaths(ctx, identityPaths, { scaleX: width / WIDTH, scaleY: height / HEIGHT, lineWidth: 0.85, strokeStyle: spectrum });
              ctx.restore();
            } else clearIdentity();
            meter.record(performance.now(), r.headers.get('X-Frame-Sequence'));
            if (encoded) {
              const sequence = r.headers.get('X-Frame-Sequence');
              if (sequence && /^\d+$/.test(sequence)) afterSequence = sequence;
              if ($('transport-status').textContent !== 'H.264 · hardware decoding preferred') $('transport-status').textContent = 'H.264 · hardware decoding preferred';
              const encode = Number(r.headers.get('X-Encode-Ms'));
              if (r.headers.has('X-Encode-Ms') && Number.isFinite(encode) && encode >= 0) {
                encodeTotal += encode;
                encodeCount++;
              }
            } else if (!videoFailed) $('transport-status').textContent = 'Raw RGBA · direct comparison';
            frames++;
            decodeTotal += decodingMs;
            fetchTotal += fetchMs;
            bodyTotal += bodyMs;
            packetWaitTotal += packetWaitMs;
            composeTotal += performance.now() - composingAt;
            if (performance.now() - rateAt >= 1000) {
              const recent = meter.snapshot(performance.now(), 1000);
              const sustained = meter.snapshot(performance.now());
              $('rate').textContent = !recent.ready
                ? `WARMING UP / ${width}×${height}`
                : recent.verified
                  ? `${recent.nativeFps.toFixed(0)} NATIVE FPS / ${width}×${height}`
                  : `${recent.readsPerSecond.toFixed(0)} READS/S / native FPS unavailable`;
              $('sustained-rate').textContent = !sustained.ready
                ? 'Warming up · collecting a meaningful frame sample'
                : sustained.verified
                  ? `${sustained.nativeFps.toFixed(1)} native FPS · ${sustained.seconds.toFixed(1)}s rolling sample`
                  : 'Native frame IDs unavailable · throughput is not render FPS';
              $('input-cost').textContent = `${((captureFrames * 1000) / (performance.now() - rateAt)).toFixed(0)} INPUT FPS · ${preparationMs.toFixed(1)} MS`;
              $('timings').textContent =
                `Encode ${encodeCount ? (encodeTotal / encodeCount).toFixed(1) + ' ms' : '—'} · decode ${(decodeTotal / frames).toFixed(1)} ms | Native snapshot ${snapshotCount ? (snapshotTotal / snapshotCount).toFixed(1) + ' ms' : 'unavailable'} | Output: packet wait ${(packetWaitTotal / frames).toFixed(1)} ms · fetch ${(fetchTotal / frames).toFixed(1)} ms · body ${(bodyTotal / frames).toFixed(1)} ms · compose ${(composeTotal / frames).toFixed(1)} ms | Input: prep ${(preparationTotal / Math.max(1, captureFrames)).toFixed(1)} ms · upload ${(uploadTotal / Math.max(1, captureFrames)).toFixed(1)} ms`;
              snapshotTotal = snapshotCount = encodeTotal = encodeCount = decodeTotal = packetWaitTotal = 0;
              frames = captureFrames = 0;
              preparationTotal = uploadTotal = fetchTotal = bodyTotal = composeTotal = 0;
              rateAt = performance.now();
            }
          }
        } finally {
          closeVideoFrame(decoded);
          showVideoResources();
        }
      })();
      await reading;
    } catch (e) {
      if (id === generation) {
        await stop();
        status(String(e));
      }
      return;
    }
  }
}
async function stop(releaseAudio = true) {
  temporalContours.reset();
  const videoDrained = drainVideoPackets();
  outputDecoder?.dispose();
  outputDecoder = null;
  const audioStopped = releaseAudio ? audio.stop() : Promise.resolve();
  generation++;
  mode = null;
  personMask?.dispose();
  personMask = null;
  $('mask-status').textContent = 'Local subject isolation for camera input.';
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  $('signal').textContent = 'NO INPUT';
  $('rate').textContent = 'NATIVE OUTPUT / IDLE';
  $('sustained-rate').textContent = 'Stopped · no active measurement';
  $('input-cost').textContent = 'INPUT TO THE LOOP';
  $<HTMLButtonElement>('stop').disabled = true;
  $('source-info').textContent = 'Input stopped. Camera tracks released.';
  $('welcome').hidden = false;
  ctx.clearRect(0, 0, output.width, output.height);
  preparedContext.clearRect(0, 0, WIDTH, HEIGHT);
  clearIdentity();
  status('Stopped. Feedback cleared.');
  const lastFrame = posting;
  const lastOutput = reading;
  await ordered(async () => {
    await Promise.all([lastFrame.catch(() => {}), lastOutput.catch(() => {}), videoDrained]);
    await post('camera/stop').catch(() => {});
  });
  await audioStopped;
  showVideoResources(true);
}
async function start(next: 'demo' | 'camera') {
  const id = generation + 1;
  await stop(false);
  if (id !== generation) return;
  status(next === 'camera' ? 'Waiting for camera permission…' : 'Waking the engine…');
  $<HTMLButtonElement>('stop').disabled = false;
  try {
    if (next === 'demo') await demoPhoto.decode();
    if (next === 'camera') {
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 60, max: 60 } }, audio: false });
      if (id !== generation) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = acquired;
      video.srcObject = stream;
      await video.play();
      stream.getVideoTracks()[0].onended = () => {
        void stop();
      };
    }
    await ordered(async () => {
      if (id === generation) await settings(true);
    });
    if (id !== generation) return;
    mode = next;
    videoFailed = false;
    $('mask-status').textContent = $<HTMLInputElement>('person-only').checked ? 'Loading local person model…' : 'Whole scene · background included.';
    if ($<HTMLInputElement>('person-only').checked) preparePersonMask();
    $('welcome').hidden = true;
    $('signal').textContent = next === 'demo' ? '● PHOTO TEST SUBJECT' : '● CAMERA LIVE';
    $('source-info').textContent = next === 'demo' ? 'Photo demo: Eileen Collins / NASA (public domain) · camera off.' : 'Camera on · contours prepared locally';
    status('Inside the feedback loop.');
    rateAt = performance.now();
    frames = captureFrames = 0;
    preparationTotal = uploadTotal = fetchTotal = bodyTotal = composeTotal = 0;
    void capture(id);
    void paint(id);
  } catch (e) {
    if (id === generation) {
      await stop();
      status(e instanceof Error ? e.message : String(e));
    }
  }
}
$('demo').onclick = $('demo-center').onclick = () => {
  void start('demo');
};
$('camera').onclick = () => {
  void start('camera');
};
$('stop').onclick = () => {
  void stop();
};
$('fullscreen').onclick = () => {
  void output.parentElement?.requestFullscreen();
};
$('rescue').onclick = () => {
  rescueUntil = performance.now() + 1000;
};
for (const id of ['mix', 'persistence', 'speed', 'detail', 'threshold', 'recognition', 'color', 'smoothing', 'steadiness']) {
  $<HTMLInputElement>(id).oninput = () => {
    $(id + '-value').textContent = id === 'speed' ? `${(value(id) / 100).toFixed(1)}×` : id === 'threshold' ? `${value(id)}` : `${value(id)}%`;
  };
  if (id === 'persistence' || id === 'speed')
    $<HTMLInputElement>(id).onchange = () => {
      if (mode) void settings().catch((e) => status(String(e)));
    };
}
let presetPage = 0;
function filteredPresets() {
  const query = $<HTMLInputElement>('preset-search').value.toLowerCase().trim();
  return presets.filter((p) => `${p.title} ${p.authors.join(' ')}`.toLowerCase().includes(query));
}
function renderPresets() {
  const items = filteredPresets();
  $('preset-count').textContent = `${items.length} presets · ${items.length ? presetPage + 1 : 0}–${Math.min(presetPage + 60, items.length)} · ← → to travel`;
  $<HTMLButtonElement>('preset-page-back').disabled = presetPage === 0;
  $<HTMLButtonElement>('preset-page-next').disabled = presetPage + 60 >= items.length;
  const list = $('preset-list');
  list.replaceChildren();
  for (const item of items.slice(presetPage, presetPage + 60)) {
    const button = document.createElement('button');
    button.className = 'preset-row';
    button.classList.toggle('selected', item.id === presetId);
    button.setAttribute('aria-pressed', String(item.id === presetId));
    if (item.thumbnail) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = `${item.thumbnail}${item.thumbnail.includes('?') ? '&' : '?'}token=${encodeURIComponent(token ?? '')}`;
      button.append(img);
    }
    const text = document.createElement('span');
    const title = document.createElement('b');
    title.textContent = item.title;
    const credit = document.createElement('small');
    credit.textContent = item.authors.join(' · ') || 'MilkDrop community';
    text.append(title, credit);
    button.append(text);
    button.onclick = () => selectPreset(item);
    list.append(button);
  }
}
function showPreset(item: CameraPreset) {
  presetId = item.id;
  const index = filteredPresets().findIndex((p) => p.id === item.id);
  if (index >= 0 && (index < presetPage || index >= presetPage + 60)) presetPage = Math.floor(index / 60) * 60;
  $('browse-presets').textContent = `${item.title} ▴`;
  document.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => b.classList.toggle('selected', `camera:${b.dataset.preset}` === item.id));
  renderPresets();
}
function selectPreset(item: CameraPreset) {
  showPreset(item);
  $('preset-error').textContent = '';
  const body = JSON.stringify({ presetId: item.id, speed: value('speed') / 100, persistence: value('persistence') / 100, resolution: $<HTMLSelectElement>('resolution').value });
  void presetSelections.request(
    async () => {
      settingsChain = settingsChain.catch(() => {}).then(() => post('camera/settings', body));
      await settingsChain;
      acceptedPresetId = item.id;
    },
    () => {
      $('credits').textContent = `Preset: ${item.title} · ${item.authors.join(', ') || 'MilkDrop community'}`;
    },
    (error) => {
      const accepted = presets.find((p) => p.id === acceptedPresetId);
      if (accepted) {
        showPreset(accepted);
        $('credits').textContent = `Preset: ${accepted.title} · ${accepted.authors.join(', ') || 'MilkDrop community'}`;
      }
      $('preset-error').textContent = String(error);
      status(String(error));
    },
  );
}
function browse(open: boolean) {
  $('preset-browser').hidden = !open;
  $('browse-presets').setAttribute('aria-expanded', String(open));
  if (open) $<HTMLInputElement>('preset-search').focus();
}
$('browse-presets').onclick = () => browse(Boolean($('preset-browser').hidden));
$('close-presets').onclick = () => {
  browse(false);
  $('browse-presets').focus();
};
$('preset-search').oninput = () => {
  presetPage = 0;
  renderPresets();
};
$('preset-page-back').onclick = () => {
  presetPage = Math.max(0, presetPage - 60);
  renderPresets();
};
$('preset-page-next').onclick = () => {
  if (presetPage + 60 < filteredPresets().length) presetPage += 60;
  renderPresets();
};
function travel(direction: number) {
  const item = stepPreset(filteredPresets(), presetId, direction);
  if (item) selectPreset(item);
}
$('previous-preset').onclick = () => travel(-1);
$('next-preset').onclick = () => travel(1);
$('random-preset').onclick = () => {
  const items = filteredPresets().filter((p) => p.id !== presetId);
  if (items.length) selectPreset(items[Math.floor(Math.random() * items.length)]);
};
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    browse(false);
    return;
  }
  if (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    travel(event.key === 'ArrowRight' ? 1 : -1);
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
  button.onclick = () => {
    const item = presets.find((p) => p.id === `camera:${button.dataset.preset}`);
    if (item) selectPreset(item);
  };
renderPresets();
if (token)
  void fetch(path('camera/presets'))
    .then(async (response) => {
      if (!response.ok) throw new Error(`Preset library unavailable (${response.status})`);
      const result: CameraPreset[] = await response.json();
      if (!Array.isArray(result) || !result.length) throw new Error('Preset library unavailable. Camera presets remain available.');
      presets = result;
      renderPresets();
    })
    .catch((error) => {
      $('preset-error').textContent = String(error);
    });
$('show-timings').onchange = () => {
  $('performance-details').hidden = !$<HTMLInputElement>('show-timings').checked;
  showVideoResources(true);
};
$('output-transport').onchange = () => {
  videoFailed = false;
};
$('resolution').onchange = () => {
  void settings().catch((error) => status(String(error)));
};
$('credits').textContent = `Preset: ${authors[0]} · OpenFlow`;
const audio = new CameraAudio(
  post,
  (message, active) => {
    $('audio-status').textContent = message;
    $('audio-toggle').textContent = active ? 'Disable audio' : 'Enable audio';
  },
  (level) => {
    $<HTMLMeterElement>('audio-meter').value = level;
  },
  () => value('gain') / 100,
);
async function audioDevices() {
  const select = $<HTMLSelectElement>('audio-device');
  const selected = select.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  select.replaceChildren(new Option('Default microphone / interface', ''));
  devices.filter((d) => d.kind === 'audioinput').forEach((d, i) => select.add(new Option(d.label || `Audio input ${i + 1}`, d.deviceId)));
  select.value = selected;
}
$('audio-toggle').onclick = () => {
  if (audio.active) void audio.stop();
  else void audio.start($<HTMLSelectElement>('audio-device').value).then(() => audioDevices().catch(() => {}));
};
$('audio-device').onchange = () => {
  if (audio.active) void audio.start($<HTMLSelectElement>('audio-device').value);
};
$('gain').oninput = () => {
  $('gain-value').textContent = `${(value('gain') / 100).toFixed(1)}×`;
};
addEventListener('pagehide', () => {
  void drainVideoPackets();
  outputDecoder?.dispose();
  outputDecoder = null;
  void audio.stop();
  generation++;
  personMask?.dispose();
  stream?.getTracks().forEach((t) => t.stop());
  try {
    navigator.sendBeacon(path('camera/stop'));
    navigator.sendBeacon(path('camera/audio/stop'));
  } catch {
    /* native source expires in two seconds */
  }
});
if (!token) status('Open the camera URL with the token printed by npm run dev.');

for (const [id, enabled] of [
  ['contour-mode', true],
  ['raw-mode', false],
] as const) {
  $(id).onclick = () => {
    useContours = enabled;
    $('feed-label').textContent = enabled ? 'Edge feed' : 'Camera feed';
    void resetPreparation();
    for (const [key, active] of [
      ['contour-mode', enabled],
      ['raw-mode', !enabled],
    ] as const) {
      $(key).classList.toggle('selected', active);
      $(key).setAttribute('aria-pressed', String(active));
    }
    for (const key of ['detail', 'threshold', 'color', 'recognition', 'smoothing', 'steadiness']) $<HTMLInputElement>(key).disabled = !enabled;
  };
}

function preparePersonMask() {
  if (personMask) return;
  const id = generation;
  personMask = new PersonMask({
    intervalMs: 100,
    onStatus: (state, error) => {
      if (id !== generation || state === 'disposed') return;
      $('mask-status').textContent =
        state === 'failed'
          ? `Person isolation unavailable: ${error ?? 'model failed'}. Uncheck Person only to use the whole scene.`
          : state === 'ready'
            ? 'Finding the person in this frame…'
            : 'Loading local person model…';
    },
  });
}
/** Source-coordinate and isolation changes are a barrier, not just a checkbox.
 * Old uploads finish before native reset; old output responses fail the generation
 * check. Camera tracks stay live while a matching new mask is acquired. */
async function resetPreparation() {
  temporalContours.reset();
  const videoDrained = drainVideoPackets();
  outputDecoder?.dispose();
  outputDecoder = null;
  personMask?.dispose();
  personMask = null;
  preparedContext.clearRect(0, 0, WIDTH, HEIGHT);
  clearIdentity();
  ctx.clearRect(0, 0, output.width, output.height);
  const enabled = $<HTMLInputElement>('person-only').checked;
  $('mask-status').textContent = enabled ? 'Waiting for a fresh person mask…' : 'Whole scene · background included.';
  if (!mode) return;
  const id = ++generation;
  const lastFrame = posting;
  const lastOutput = reading;
  status('Clearing the previous source…');
  try {
    await ordered(async () => {
      await Promise.all([lastFrame.catch(() => {}), lastOutput.catch(() => {}), videoDrained]);
      await post('camera/stop');
      if (id === generation && mode) await settings();
    });
    if (id !== generation || !mode) return;
    if (enabled) preparePersonMask();
    status('Inside the feedback loop.');
    void capture(id);
    void paint(id);
  } catch (error) {
    if (id === generation) {
      await stop();
      status(String(error));
    }
  }
}
$<HTMLInputElement>('person-only').onchange = () => {
  void resetPreparation();
};
$<HTMLInputElement>('mirror').onchange = () => {
  void resetPreparation();
};

void videoCapability().then(({ codec, message }) => {
  $('video-capability').textContent = message;
  $('video-capability').dataset.codec = codec ?? '';
  supportedVideoCodec = codec?.startsWith('avc1.64') ? codec : null;
  $('transport-status').textContent = supportedVideoCodec ? 'Hardware H.264 ready' : 'Raw RGBA · compatible decoder unavailable';
});
