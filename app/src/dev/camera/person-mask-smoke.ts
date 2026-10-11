import { PersonMask } from './person-mask';
import astronautUrl from './person-assets/astronaut.png?url';
const photo = document.querySelector<HTMLCanvasElement>('#photo')!;
const output = document.querySelector<HTMLCanvasElement>('#mask')!;
const status = document.querySelector<HTMLElement>('#status')!;
const image = new Image();
image.src = astronautUrl;
await image.decode();
photo.getContext('2d')!.drawImage(image, 0, 0);
let samples = 0;
const times: number[] = [];
let previous: Float32Array | null = null;
const mask = new PersonMask({
  onStatus: (state, error) => {
    if (state !== 'disposed') status.textContent = `${state}: ${error ?? ''}`;
  },
});
const interval = setInterval(() => {
  mask.update(photo);
  const latest = mask.latest;
  if (!latest || latest.data === previous) return;
  previous = latest.data;
  times.push(latest.inferenceMs);
  samples++;
  output.width = latest.width;
  output.height = latest.height;
  const pixels = new ImageData(latest.width, latest.height);
  latest.data.forEach((value, index) => {
    pixels.data[index * 4] = pixels.data[index * 4 + 1] = pixels.data[index * 4 + 2] = value * 255;
    pixels.data[index * 4 + 3] = 255;
  });
  output.getContext('2d')!.putImageData(pixels, 0, 0);
  const at = (x: number, y: number) => latest.data[Math.floor(y * latest.height) * latest.width + Math.floor(x * latest.width)];
  status.textContent = JSON.stringify({
    samples,
    width: latest.width,
    height: latest.height,
    meanInferenceMs: times.reduce((a, b) => a + b) / times.length,
    face: at(0.44, 0.25),
    room: at(0.95, 0.1),
  });
  if (samples >= 30) {
    clearInterval(interval);
    mask.dispose();
  }
}, 33);
