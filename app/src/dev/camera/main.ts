import './style.css';
import { TOKEN_KEY, tokenFrom } from '../bridge';

const root = document.querySelector<HTMLDivElement>('#camera-app')!;
root.innerHTML = `
<header><a class="wordmark" href="#">open<span>flow</span></a><div class="edition">EXPERIMENT 001 <span>↗ LIVE CAMERA LAB</span></div><div class="local"><i></i> LOCAL SIGNAL</div></header>
<main><div class="intro"><div><p class="eyebrow">YOUR FACE. THE FEEDBACK LOOP.</p><h1>Camera <em>possession.</em></h1></div><p class="lede">Become a beautiful signal problem.<br>Feed yourself into the MilkDrop machine.</p></div>
<section class="instrument" aria-label="Camera instrument"><div class="stage"><canvas id="output" width="960" height="540" aria-label="Processed native engine output"></canvas><div class="stage-top"><span id="signal">NO INPUT</span><span id="rate">NATIVE MILKDROP / METAL</span></div><div id="welcome"><div class="orb">◎</div><h2>Something wants to see you.</h2><p>Try the test subject first. Then become it.</p><button id="demo-center">Run demo <span>↗</span></button></div><div class="stage-bottom"><span id="status" role="status" aria-live="polite">Ready when you are.</span><button id="fullscreen" aria-label="Full screen output">⛶</button></div></div>
<aside><div class="section-title">01 <span>CHOOSE YOUR AFFLICTION</span></div><div class="presets"><button data-preset="0" class="selected"><b>Liquid identity</b><span>A face that refuses to stay put</span><i>01</i></button><button data-preset="1"><b>Molten mind</b><span>Spill into the room around you</span><i>02</i></button><button data-preset="2"><b>Psychotrip</b><span>Turn the whole world inside out</span><i>03</i></button></div>
<div class="section-title">02 <span>LOSE YOUR COMPOSURE</span></div>
<label class="knob"><span>Fresh camera <output id="mix-value">14%</output></span><input id="mix" type="range" min="0" max="100" value="14"/><small>Ghosts ← → Recognition</small></label>
<label class="knob"><span>Afterimage <output id="persistence-value">65%</output></span><input id="persistence" type="range" min="0" max="98" value="65"/><small>Let your past selves linger</small></label>
<label class="knob"><span>Speed <output id="speed-value">0.8×</output></span><input id="speed" type="range" min="10" max="300" value="80"/><small>Slow hypnosis → Full possession</small></label>
<label class="mirror"><input id="mirror" type="checkbox" checked/> Mirror source <span>↔</span></label><button id="rescue">Bring my face back <span>↶</span></button></aside></section>
<div class="transport"><div><button id="camera" class="primary">Start camera <span>↗</span></button><button id="demo">Run demo</button><button id="stop" disabled>Stop</button></div><p id="source-info">No camera or microphone access until you ask.</p></div>
<footer><span>Camera → native OpenFlow feedback → browser</span><span>Flashing & moving imagery. Start gently.</span></footer><p class="credits" id="credits"></p></main>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const output = $<HTMLCanvasElement>('output');
const ctx = output.getContext('2d')!;
const input = document.createElement('canvas');
input.width = 640;
input.height = 360;
const g = input.getContext('2d', { willReadFrequently: true })!;
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
const authors = ['Harlequin’s Liquid Dragon · Rovastar', 'Molten Indecision · Krash & Fvese (Fvese Remix)', 'Psychotrip · Pithlit (Spinning colours mix / orthorotate recursive helicities3)'];
let preset = 0;
let mode: 'demo' | 'camera' | null = null;
let stream: MediaStream | null = null;
let generation = 0;
let posting: Promise<void> = Promise.resolve();
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
  g.fillStyle = '#121526';
  g.fillRect(0, 0, 640, 360);
  for (let x = 0; x < 640; x += 40) {
    g.strokeStyle = '#404569';
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 360);
    g.stroke();
  }
  for (let y = 0; y < 360; y += 40) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(640, y);
    g.stroke();
  }
  g.save();
  g.translate(320 + Math.sin(t * 0.7) * 95, 180 + Math.cos(t) * 22);
  g.rotate(Math.sin(t * 0.8) * 0.2);
  g.fillStyle = '#a89aff';
  g.beginPath();
  g.ellipse(0, 0, 89, 122, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#efff92';
  g.fillRect(-63, -46, 46, 31);
  g.fillRect(17, -46, 46, 31);
  g.fillStyle = '#1c1b35';
  g.fillRect(-41 + Math.sin(t) * 6, -39, 10, 20);
  g.fillRect(35 + Math.sin(t) * 6, -39, 10, 20);
  g.strokeStyle = '#1c1b35';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(0, -5);
  g.lineTo(-11, 29);
  g.lineTo(10, 29);
  g.stroke();
  g.strokeStyle = '#ff677e';
  g.lineWidth = 15;
  g.beginPath();
  g.arc(0, 43, 36, 0.2, Math.PI - 0.2);
  g.stroke();
  g.restore();
  g.fillStyle = '#efff92';
  g.font = 'bold 14px monospace';
  g.fillText('TEST SUBJECT / 001', 20, 30);
}
function renderInput() {
  g.save();
  if ($<HTMLInputElement>('mirror').checked) {
    g.translate(640, 0);
    g.scale(-1, 1);
  }
  if (mode === 'demo') drawDemo(performance.now() / 1000);
  else {
    const scale = Math.max(640 / video.videoWidth, 360 / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    g.drawImage(video, (640 - w) / 2, (360 - h) / 2, w, h);
  }
  g.restore();
}
async function capture(id: number) {
  while (id === generation && mode) {
    const start = performance.now();
    renderInput();
    const mix = performance.now() < rescueUntil ? 0.8 : value('mix') / 100;
    const data = g.getImageData(0, 0, 640, 360).data;
    posting = post(`camera/frame?w=640&h=360&mix=${mix}`, data.buffer);
    try {
      await posting;
    } catch (e) {
      if (id === generation) {
        await stop();
        status(String(e));
      }
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, 66 - (performance.now() - start))));
  }
}
async function paint(id: number) {
  while (id === generation && mode) {
    const start = performance.now();
    try {
      const r = await fetch(path('frame'), { cache: 'no-store' });
      if (r.status !== 200) throw new Error(`Output unavailable (${r.status})`);
      const image = await createImageBitmap(await r.blob());
      if (id === generation) {
        ctx.drawImage(image, 0, 0, output.width, output.height);
        frames++;
        if (performance.now() - rateAt >= 1000) {
          $('rate').textContent = `${((frames * 1000) / (performance.now() - rateAt)).toFixed(0)} FPS / NATIVE OUTPUT`;
          frames = 0;
          rateAt = performance.now();
        }
      }
      image.close();
    } catch (e) {
      if (id === generation) {
        await stop();
        status(String(e));
      }
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, 50 - (performance.now() - start))));
  }
}
async function stop() {
  generation++;
  mode = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  $('signal').textContent = 'NO INPUT';
  $<HTMLButtonElement>('stop').disabled = true;
  $('source-info').textContent = 'Input stopped. Camera tracks released.';
  $('welcome').hidden = false;
  ctx.clearRect(0, 0, 960, 540);
  status('Stopped. Feedback cleared.');
  const lastFrame = posting;
  await ordered(async () => {
    await lastFrame.catch(() => {});
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
    if (next === 'camera') {
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 } }, audio: false });
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
    $('welcome').hidden = true;
    $('signal').textContent = next === 'demo' ? '● TEST SUBJECT' : '● CAMERA LIVE';
    $('source-info').textContent = next === 'demo' ? 'Synthetic source. Your camera is off.' : 'Camera on · 640 × 360 · loopback only · no microphone';
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
for (const id of ['mix', 'persistence', 'speed']) {
  $<HTMLInputElement>(id).oninput = () => {
    $(id + '-value').textContent = id === 'speed' ? `${(value(id) / 100).toFixed(1)}×` : `${value(id)}%`;
  };
  if (id !== 'mix')
    $<HTMLInputElement>(id).onchange = () => {
      if (mode) void settings().catch((e) => status(String(e)));
    };
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
  button.onclick = () => {
    preset = Number(button.dataset.preset);
    document.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('selected', b === button));
    $('credits').textContent = `Preset: ${authors[preset]}. Included OpenFlow starter presets; original artists credited.`;
    if (mode) void settings(true).catch((e) => status(String(e)));
  };
}
$('credits').textContent = `Preset: ${authors[0]}. Included OpenFlow starter presets; original artists credited.`;
addEventListener('pagehide', () => {
  generation++;
  stream?.getTracks().forEach((t) => t.stop());
  try {
    navigator.sendBeacon(path('camera/stop'));
  } catch {
    /* native source expires in two seconds */
  }
});
if (!token) status('Open the camera URL with the token printed by npm run dev.');
