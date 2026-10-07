# The teaser

A 30 s teaser for visual[flow]: the engine's own frames, drawn from the music, under titles
made in [Remotion](https://www.remotion.dev) (React components rendered to video). It is its
own package with its own `node_modules`; run the commands below from `teaser/`.

Three steps, each feeding the next: the music → the footage → the finished video. The
music and footage go in `public/` (Remotion serves that folder), the finished renders in
`out/`; git ignores both.

## 1. The music

Until there is a real track, a placeholder: 128 bpm, so a bar is 1.875 s and 16 bars are
30 s. Kick from the start, hats and bass from bar 3, a breakdown with a riser at bars
9–10 (15–18.75 s), the drop at bar 11, a pad to close from 26.25 s.

```sh
ffmpeg -y -v error -f lavfi -i "aevalsrc=exprs='st(0,mod(t,0.46875));st(1,mod(t+0.234375,0.46875));st(2,between(t,3.75,15)+between(t,18.75,26.25));st(3,if(lt(mod(floor(t/1.875),4),2),55,43.65));(1-between(t,15,18.75)-gte(t,26.25))*0.9*sin(2*PI*(50*ld(0)+4*(1-exp(-25*ld(0)))))*exp(-7*ld(0)) + ld(2)*0.12*(random(4)*2-1)*exp(-80*ld(1)) + ld(2)*0.3*sin(2*PI*ld(3)*t)*(1-exp(-10*ld(0))) + 0.06*(sin(2*PI*220*t)+sin(2*PI*261.63*t)+sin(2*PI*329.63*t))*(1+2*between(t,15,18.75))*min(1,(30-t)/3) + between(t,15,18.75)*0.25*(t-15)/3.75*(random(5)*2-1)':s=44100:d=30,alimiter=limit=0.9" -ac 2 public/beat.wav
```

A real track replaces `public/beat.wav`; then change `BPM`, `BARS` and `SECTIONS` in
`src/timing.ts` and the times in `cuts.txt` to its arrangement.

## 2. The footage

The engine's `record` binary draws the presets in [`cuts.txt`](cuts.txt) from the music, a
frame at a time, and muxes the music in. Each line starts a preset at a time in seconds,
on the bar lines; it runs each one for 2 s unseen before its cut, so it lands already
drawing.

```sh
cargo run --release -p visuals-engine --bin record -- public/beat.wav public/footage.mp4 --cuts cuts.txt
```

Add `--size 3840x2160` for a 4K master. 1080p draws at about 32 fps on an M-series Mac, so
the 30 s take about a minute.

To pick presets, audition a batch: many `--cut`s a second or so apart at `--size 640x360`,
then look at a frame from each. Presets that build up slowly from black, or blow out to
white on this beat, read badly in a cut.

## 3. The video

```sh
npm ci
npm run studio   # Remotion's editor in the browser: scrub, tweak, see it live
npm run render   # out/teaser.mp4, 1920x1080
npx remotion render src/index.ts TeaserVertical out/teaser-vertical.mp4   # 1080x1920
```

[`src/Teaser.tsx`](src/Teaser.tsx) is the whole edit: the footage, the intro, a fact a bar,
the diagram in the breakdown, the drop, the wordmark. Everything is placed in bars and
beats from [`src/timing.ts`](src/timing.ts), so it stays on the music when the music
changes.

`npm run typecheck` checks it; the repo's own `npm run typecheck` doesn't reach this folder.

Remotion is free for individuals and companies of up to three people; bigger companies
need its company licence.
