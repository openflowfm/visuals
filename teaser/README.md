# The teaser

A 52 s teaser for visual[flow]: the engine's own frames, drawn from the music, under titles
made in [Remotion](https://www.remotion.dev) (React components rendered to video). It is its
own package with its own `node_modules`; run the commands below from `teaser/`.

Three steps, each feeding the next: the music → the footage → the finished video. The
music and footage go in `public/` (Remotion serves that folder), the finished renders in
`out/`; git ignores both.

## 1. The music

Until there is a real track, a placeholder: 128 bpm, so a bar is 1.875 s; 28 bars are
52.5 s. Pad and soft hats under the 2001 cold open (bars 0–4, with a riser into bar 4),
the kick from bar 4, hats and bass from bar 6, a breakdown with a riser at bars 13–16
(24.375–30 s), the drop at bar 16 for eight bars, a pad to close from bar 24 (45 s).

```sh
ffmpeg -y -v error -f lavfi -i "aevalsrc=exprs='st(0,mod(t,0.46875));st(1,mod(t+0.234375,0.46875));st(2,between(t,11.25,24.375)+between(t,30,45));st(3,if(lt(mod(floor(t/1.875),4),2),55,43.65));(gte(t,7.5)-between(t,24.375,30)-gte(t,45))*0.9*sin(2*PI*(50*ld(0)+4*(1-exp(-25*ld(0)))))*exp(-7*ld(0)) + (ld(2)+0.5*lt(t,7.5))*0.12*(random(4)*2-1)*exp(-80*ld(1)) + ld(2)*0.3*sin(2*PI*ld(3)*t)*(1-exp(-10*ld(0))) + 0.06*(sin(2*PI*220*t)+sin(2*PI*261.63*t)+sin(2*PI*329.63*t))*(1+2*between(t,24.375,30)+1.5*lt(t,7.5))*min(1,(52.5-t)/4) + (between(t,24.375,30)*(t-24.375)/5.625+between(t,5.625,7.5)*(t-5.625)/1.875)*0.25*(random(5)*2-1)':s=44100:d=52.5,alimiter=limit=0.9" -ac 2 public/beat.wav
```

A real track replaces `public/beat.wav`; then change `BPM`, `BARS` and `SECTIONS` in
`src/timing.ts` and the times in `cuts.txt` and `origin.txt` to its arrangement.

## 2. The footage

The engine's `record` binary draws presets from the music, a frame at a time, and muxes
the music in. Each line of a cut list starts a preset at a time in seconds, on the bar
lines; it runs each one for 2 s unseen before its cut, so it lands already drawing.

Two takes: the HD footage from [`cuts.txt`](cuts.txt), and the cold open's little window
from [`origin.txt`](origin.txt) — Ryan Geiss's own presets at 320x240, shown pixelated.

```sh
cargo run --release -p visuals-engine --bin record -- public/beat.wav public/footage.mp4 --cuts cuts.txt
cargo run --release -p visuals-engine --bin record -- public/beat.wav public/origin.mp4 --cuts origin.txt --size 320x240 --to 8
```

The window's last preset is also the first of `cuts.txt`, so when the grown window gives
way to the HD footage on the downbeat it is the same picture, sharpened.

Add `--size 3840x2160` to the first for a 4K master. 1080p draws at about 20–30 fps on an
M-series Mac, so the 52 s take two or three minutes.

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

[`src/Teaser.tsx`](src/Teaser.tsx) is the whole edit: the 2001 cold open and "25 Years
Later", the title, the facts, Link and the gear it syncs, the diagram in the breakdown,
DROP OUT and eight bars of presets, and the name, held back until the end.
Everything is placed in bars and beats from [`src/timing.ts`](src/timing.ts), so it stays
on the music when the music changes.

The cold open names Winamp but draws a generic Windows-era window, not Winamp's skin or
logo, which are its owner's trademarks.

`npm run typecheck` checks it; the repo's own `npm run typecheck` doesn't reach this folder.

Remotion is free for individuals and companies of up to three people; bigger companies
need its company licence.
