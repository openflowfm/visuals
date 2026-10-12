import './style.css';
import { TOKEN_KEY, tokenFrom } from '../bridge';
import { Contours, rawFrameSize } from './contours';
import { ColorSignal } from './color-signal';
import { PersonMask } from './person-mask';
import demoPhotoUrl from './person-assets/astronaut.png?url';

const root = document.querySelector<HTMLDivElement>('#camera-app')!;
root.innerHTML = `
<header><a class="wordmark" href="#">open<span>flow</span></a><div class="edition">EXPERIMENT 001 <span>↗ LIVE CAMERA LAB</span></div><div class="local"><i></i> LOCAL SIGNAL</div></header>
<main><div class="intro"><div><p class="eyebrow">YOUR FACE. THE FEEDBACK LOOP.</p><h1>Camera <em>possession.</em></h1></div><p class="lede">Become a beautiful signal problem.<br>Feed yourself into the MilkDrop machine.</p></div>
<section class="instrument" aria-label="Camera instrument"><div class="stage"><canvas id="output" width="960" height="540" aria-label="Processed native engine output"></canvas><div class="stage-top"><span id="signal">NO INPUT</span><span id="rate">NATIVE MILKDROP / METAL</span></div><div id="welcome"><div class="orb">◎</div><h2>Something wants to see you.</h2><p>Try the test subject first. Then become it.</p><button id="demo-center">Run demo <span>↗</span></button></div><div class="stage-bottom"><span id="status" role="status" aria-live="polite">Ready when you are.</span><button id="fullscreen" aria-label="Full screen output">⛶</button></div></div>
<aside><div class="section-title">01 <span>CHOOSE YOUR AFFLICTION</span></div><div class="presets"><button data-preset="0" class="selected"><b>Chromatic vortex</b><span>Spiral into a spectral wormhole</span><i>01</i></button><button data-preset="1"><b>Prism cult</b><span>Sixfold stained-glass hallucination</span><i>02</i></button><button data-preset="2"><b>Acid tide</b><span>Liquid ribbons and chromatic rupture</span><i>03</i></button></div>
<div class="section-title">02 <span>LOSE YOUR COMPOSURE</span></div>
<label class="knob"><span>Recognition <output id="recognition-value">85%</output></span><input id="recognition" type="range" min="0" max="100" value="85"/><small>Pure hallucination → Keep me present</small></label>
<label class="knob"><span>Color <output id="color-value">100%</output></span><input id="color" type="range" min="0" max="100" value="100"/><small>Silver → Full spectrum</small></label>
<label class="knob"><span>Fresh camera <output id="mix-value">9%</output></span><input id="mix" type="range" min="0" max="100" value="9"/><small>Sparse ink → Dense ink</small></label>
<label class="knob"><span>Afterimage <output id="persistence-value">65%</output></span><input id="persistence" type="range" min="0" max="98" value="65"/><small>Let your past selves linger</small></label>
<label class="knob"><span>Speed <output id="speed-value">0.8×</output></span><input id="speed" type="range" min="10" max="300" value="80"/><small>Slow hypnosis → Full possession</small></label>
<label class="mirror"><input id="mirror" type="checkbox" checked/> Mirror source <span>↔</span></label><button id="rescue">Bring my face back <span>↶</span></button></aside></section>
<section class="input-tools" aria-label="Source preparation"><div class="input-preview"><canvas id="prepared" width="320" height="180" aria-label="Prepared input sent to feedback"></canvas><span id="input-cost">INPUT TO THE LOOP</span></div><div class="input-choice"><p class="eyebrow">DISTILL THE SIGNAL</p><div class="source-modes"><button id="contour-mode" class="selected" aria-pressed="true">Contours</button><button id="raw-mode" aria-pressed="false">Raw camera</button></div><label class="person-choice"><input id="person-only" type="checkbox" checked/> Person only</label><p id="mask-status" role="status">Local subject isolation for camera input.</p></div><label class="knob"><span>Edge detail <output id="detail-value">45%</output></span><input id="detail" type="range" min="0" max="100" value="45"/><small>Soft silhouette → Fine features</small></label><label class="knob"><span>Noise cutoff <output id="threshold-value">12</output></span><input id="threshold" type="range" min="1" max="60" value="12"/><small>Raise to remove room texture</small></label></section><div class="transport"><div><button id="camera" class="primary">Start camera <span>↗</span></button><button id="demo">Run demo</button><button id="stop" disabled>Stop</button></div><p id="source-info">No camera or microphone access until you ask.</p></div>
<footer><span>One person → spectral feedback + crisp identity</span><span>Flashing & moving imagery. Start gently.</span></footer><p class="credits" id="credits"></p></main>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const output = $<HTMLCanvasElement>('output');
const ctx = output.getContext('2d')!;
const input = document.createElement('canvas');
const WIDTH = 320,
  HEIGHT = 180,
  FRAME_MS = 1000 / 30;
input.width = WIDTH;
input.height = HEIGHT;
const contours = new Contours(WIDTH, HEIGHT);
const colorSignal = new ColorSignal(WIDTH, HEIGHT);
const identity = document.createElement('canvas');
identity.id = 'identity-source';
identity.width = WIDTH;
identity.height = HEIGHT;
const identityContext = identity.getContext('2d')!;
let identityAt = -Infinity;
function clearIdentity() {
  identityAt = -Infinity;
  identityContext.clearRect(0, 0, WIDTH, HEIGHT);
}
const prepared = $<HTMLCanvasElement>('prepared');
const preparedContext = prepared.getContext('2d')!;
let useContours = true;
let personMask: PersonMask | null = null;
let preparationMs = 0;
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
let preset = 0;
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
  const body = JSON.stringify({ preset: load ? preset : null, speed: value('speed') / 100, persistence: value('persistence') / 100 });
  settingsChain = settingsChain.catch(() => {}).then(() => post('camera/settings', body));
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
        if (personMask?.status === 'ready') $('mask-status').textContent = 'Waiting for a fresh person mask…';
        await new Promise((r) => setTimeout(r, FRAME_MS));
        continue;
      }
      const mix = performance.now() < rescueUntil ? 0.8 : value('mix') / 100;
      const filterStarted = performance.now();
      const source = g.getImageData(0, 0, WIDTH, HEIGHT).data;
      let data: Uint8ClampedArray;
      if (useContours) {
        const edges = contours.process(source, value('detail'), value('threshold'), mask ?? undefined);
        data = colorSignal.prepare(edges, source, mask ? contours.foreground : null, value('color'), performance.now() / 1000);
      } else data = mask ? contours.cutout(source, mask) : source;
      preparedContext.putImageData(new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), WIDTH, HEIGHT), 0, 0);
      preparationMs = performance.now() - filterStarted;
      posting = post(`camera/frame?w=${WIDTH}&h=${HEIGHT}&mix=${mix}`, data.buffer as ArrayBuffer);
      await posting;
      // Commit the exact source used for the successful upload. A reset may have
      // happened while the request was in flight; never revive its old identity.
      if (id === generation && useContours && (!isolate || personMask?.current())) {
        identityContext.putImageData(new ImageData(colorSignal.identity, WIDTH, HEIGHT), 0, 0);
        identityAt = mask?.capturedAt ?? start;
      }
    } catch (e) {
      if (id === generation) {
        await stop();
        status(String(e));
      }
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, FRAME_MS - (performance.now() - start))));
  }
}
async function paint(id: number) {
  while (id === generation && mode) {
    const start = performance.now();
    try {
      reading = (async () => {
        const r = await fetch(path('camera/output'), { cache: 'no-store' });
        if (r.status !== 200) throw new Error(`Output unavailable (${r.status})`);
        const buffer = await r.arrayBuffer();
        const [width, height] = rawFrameSize(r.headers, buffer.byteLength);
        const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
        if (id === generation) {
          if (output.width !== width || output.height !== height) {
            output.width = width;
            output.height = height;
          }
          ctx.putImageData(image, 0, 0);
          if (performance.now() - identityAt <= 250 && useContours) {
            ctx.save();
            ctx.globalAlpha = performance.now() < rescueUntil ? 1 : value('recognition') / 100;
            ctx.drawImage(identity, 0, 0, width, height);
            ctx.restore();
          } else clearIdentity();
          frames++;
          if (performance.now() - rateAt >= 1000) {
            $('rate').textContent = `${((frames * 1000) / (performance.now() - rateAt)).toFixed(0)} FPS / NATIVE OUTPUT`;
            $('input-cost').textContent = `${useContours ? 'CONTOURS' : 'RAW'} / ${preparationMs.toFixed(1)} MS`;
            frames = 0;
            rateAt = performance.now();
          }
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
    await new Promise((r) => setTimeout(r, Math.max(0, FRAME_MS - (performance.now() - start))));
  }
}
async function stop() {
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
    await Promise.all([lastFrame.catch(() => {}), lastOutput.catch(() => {})]);
    await post('camera/stop').catch(() => {});
  });
}
async function start(next: 'demo' | 'camera') {
  const id = generation + 1;
  await stop();
  if (id !== generation) return;
  status(next === 'camera' ? 'Waiting for camera permission…' : 'Waking the engine…');
  $<HTMLButtonElement>('stop').disabled = false;
  try {
    if (next === 'demo') await demoPhoto.decode();
    if (next === 'camera') {
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
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
    $('mask-status').textContent = $<HTMLInputElement>('person-only').checked ? 'Loading local person model…' : 'Whole scene · background included.';
    if ($<HTMLInputElement>('person-only').checked) preparePersonMask();
    $('welcome').hidden = true;
    $('signal').textContent = next === 'demo' ? '● PHOTO TEST SUBJECT' : '● CAMERA LIVE';
    $('source-info').textContent = next === 'demo' ? 'Photo demo: Eileen Collins / NASA (public domain) · camera off.' : 'Camera on · contours prepared locally · no microphone';
    status('Inside the feedback loop.');
    rateAt = performance.now();
    frames = 0;
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
for (const id of ['mix', 'persistence', 'speed', 'detail', 'threshold', 'recognition', 'color']) {
  $<HTMLInputElement>(id).oninput = () => {
    $(id + '-value').textContent = id === 'speed' ? `${(value(id) / 100).toFixed(1)}×` : id === 'threshold' ? `${value(id)}` : `${value(id)}%`;
  };
  if (id === 'persistence' || id === 'speed')
    $<HTMLInputElement>(id).onchange = () => {
      if (mode) void settings().catch((e) => status(String(e)));
    };
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
  button.onclick = () => {
    preset = Number(button.dataset.preset);
    document.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('selected', b === button));
    $('credits').textContent = `Preset: ${authors[preset]}. Camera-native OpenFlow preset.`;
    if (mode) void settings(true).catch((e) => status(String(e)));
  };
}
$('credits').textContent = `Preset: ${authors[0]}. Camera-native OpenFlow preset.`;
addEventListener('pagehide', () => {
  generation++;
  personMask?.dispose();
  stream?.getTracks().forEach((t) => t.stop());
  try {
    navigator.sendBeacon(path('camera/stop'));
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
    void resetPreparation();
    for (const [key, active] of [
      ['contour-mode', enabled],
      ['raw-mode', !enabled],
    ] as const) {
      $(key).classList.toggle('selected', active);
      $(key).setAttribute('aria-pressed', String(active));
    }
    for (const key of ['detail', 'threshold']) $<HTMLInputElement>(key).disabled = !enabled;
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
      await Promise.all([lastFrame.catch(() => {}), lastOutput.catch(() => {})]);
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
