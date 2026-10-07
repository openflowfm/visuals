# The teaser

A ~30 s teaser for visual[flow], made from the engine's own frames. Everything it renders
goes in `teaser/out/`, which git ignores.

## 1. The music

Until there is a real track, a placeholder: 128 bpm, so a bar is 1.875 s and 16 bars are
30 s. Kick from the start, hats and bass from bar 3, a breakdown with a riser at bars
9–10 (15–18.75 s), the drop at bar 11, a pad to close from 26.25 s.

```sh
mkdir -p teaser/out && ffmpeg -y -v error -f lavfi -i "aevalsrc=exprs='st(0,mod(t,0.46875));st(1,mod(t+0.234375,0.46875));st(2,between(t,3.75,15)+between(t,18.75,26.25));st(3,if(lt(mod(floor(t/1.875),4),2),55,43.65));(1-between(t,15,18.75)-gte(t,26.25))*0.9*sin(2*PI*(50*ld(0)+4*(1-exp(-25*ld(0)))))*exp(-7*ld(0)) + ld(2)*0.12*(random(4)*2-1)*exp(-80*ld(1)) + ld(2)*0.3*sin(2*PI*ld(3)*t)*(1-exp(-10*ld(0))) + 0.06*(sin(2*PI*220*t)+sin(2*PI*261.63*t)+sin(2*PI*329.63*t))*(1+2*between(t,15,18.75))*min(1,(30-t)/3) + between(t,15,18.75)*0.25*(t-15)/3.75*(random(5)*2-1)':s=44100:d=30,alimiter=limit=0.9" -ac 2 teaser/out/beat.wav
```

## 2. The footage

`record` draws presets from the music, a frame at a time, and muxes the music in. Each
`--cut` starts a preset at a time in seconds; put them on the bar lines. Preset paths
are in the pack (`~/.openflow/visuals/presets`) or anywhere on disk.

```sh
cargo run --release -p visuals-engine --bin record -- teaser/out/beat.wav teaser/out/footage.mp4 \
  --cut 0 "cream-of-the-crop/Dancer/Aurora/Jc - Crystal Shards.milk" \
  --cut 3.75 "cream-of-the-crop/Dancer/Aurora/\$\$\$ Royal - Mashup (257).milk" \
  --cut 5.625 "cream-of-the-crop/Dancer/Aurora/Jc - Flower.milk"
```

`--size 3840x2160` for the final cut, `.mov` for ProRes. 1080p draws at about 36 fps on an
M-series Mac, so the 30 s take under a minute.

A hard cut starts a preset from an empty frame, so one that builds up slowly (Jc - Lungs)
shows black for a while: pick presets that fill the screen within a beat.
