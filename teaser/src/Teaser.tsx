import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadSans } from '@remotion/google-fonts/SpaceGrotesk';
import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BAR, BARS, BEAT, bar, beat, beatPhase, FPS, kick, LENGTH, SECTIONS, sectionAt } from './timing';

const { fontFamily: sans } = loadSans('normal', { weights: ['500', '700'], subsets: ['latin'] });
const { fontFamily: mono } = loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] });

const ACCENT = '#c8ff3e';
const SHADOW = '0 2px 6px rgba(0,0,0,0.9), 0 0 24px rgba(0,0,0,0.85), 0 0 72px rgba(0,0,0,0.7)';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** One unit: 1px at 1080 on the short side, so both formats scale alike. */
const useUnit = () => {
  const { width, height } = useVideoConfig();
  return { u: Math.min(width, height) / 1080, vertical: height > width };
};

/** A springy 0..1 from `start`, and 1..0 over `out` frames ending at `end`. */
const useShow = (start: number, end: number, out = 8) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - start, fps, config: { damping: 14, stiffness: 200 } });
  const exit = interpolate(frame, [end - out, end], [1, 0], clamp);
  return frame < start || frame >= end ? 0 : Math.min(enter, exit);
};

const Footage = () => {
  const frame = useCurrentFrame();
  const section = sectionAt(frame);
  const [b0, b1] = SECTIONS.breakdown.map(bar);
  const half = beat(0.5);
  const dim = interpolate(frame, [b0 - half, b0 + half, b1 - beat(1), b1], [0, 1, 1, 0], clamp);
  const pulse = section === 'drop' ? 0.04 : section === 'facts' ? 0.015 : 0;
  // Black, then the first preset blooms in over the first bar.
  const open = interpolate(frame, [0, bar(1)], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const close = interpolate(frame, [LENGTH - beat(2), LENGTH], [1, 0], clamp);
  const outro = interpolate(frame, [bar(14), bar(14.5)], [1, 0.55], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <OffthreadVideo
        src={staticFile('footage.mp4')}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: open * close,
          transform: `scale(${1.02 + pulse * kick(frame)})`,
          filter: `brightness(${(1 - 0.6 * dim) * outro}) blur(${dim * 10}px) saturate(${1 + 0.2 * dim})`,
        }}
      />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.65) 100%)' }} />
    </AbsoluteFill>
  );
};

/** White on the drop, and a glint on each preset change under the facts. */
const Flash = () => {
  const frame = useCurrentFrame();
  const since = (at: number) => (frame >= at ? Math.exp(-(frame - at) / 10) : 0);
  let v = since(bar(SECTIONS.drop[0]));
  for (let b = SECTIONS.facts[0] + 1; b < SECTIONS.facts[1]; b++) v = Math.max(v, 0.12 * since(bar(b)));
  return <AbsoluteFill style={{ backgroundColor: 'white', opacity: v, mixBlendMode: 'screen' }} />;
};

/** Centred text, over a soft dark pool (`scrim`, 0..1) that keeps it readable on any preset. */
const Center = ({ children, style, scrim = 0 }: { children: ReactNode; style?: CSSProperties; scrim?: number }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', ...style }}>
    <AbsoluteFill
      style={{
        opacity: scrim,
        background: 'radial-gradient(ellipse 60% 32% at center, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)',
      }}
    />
    {children}
  </AbsoluteFill>
);

const Intro = () => {
  const { u } = useUnit();
  const first = useShow(beat(2), bar(2));
  const second = useShow(bar(1), bar(2));
  const line = (v: number, text: string, color = 'white') => (
    <div
      style={{
        fontFamily: sans,
        fontWeight: 700,
        fontSize: 120 * u,
        letterSpacing: -3 * u,
        lineHeight: 1.05,
        color,
        opacity: v,
        transform: `translateY(${(1 - v) * 40 * u}px)`,
        textShadow: SHADOW,
      }}
    >
      {text}
    </div>
  );
  return (
    <Center scrim={first}>
      {line(first, 'Your music')}
      {line(second, 'now has eyes.', ACCENT)}
    </Center>
  );
};

/** Big lines, two bars each: long enough to read while the presets change under them. */
const FACT_BARS = 2;
const FACTS = ['9,744 MilkDrop presets', 'Native, on the GPU'];

/** Some of what speaks Ableton Link — ableton.com/link/products, plus Traktor, Serato and Bitwig. */
const LINKED = [
  'Ableton Live',
  'Akai MPC',
  'Logic Pro',
  'Pro Tools',
  'Bitwig Studio',
  'rekordbox',
  'Traktor',
  'Serato DJ',
  'Denon DJ Prime',
  'djay',
];

/** The last two bars of the facts: Link, and the names it brings along, one a half-beat. */
const LinkWall = () => {
  const frame = useCurrentFrame();
  const { u, vertical } = useUnit();
  const start = bar(SECTIONS.facts[0] + FACTS.length * FACT_BARS);
  const v = useShow(start, bar(SECTIONS.facts[1]), beat(0.5));
  if (!v) return null;
  return (
    <Center scrim={v}>
      <div
        style={{
          opacity: v,
          transform: `scale(${1.12 - 0.12 * v})`,
          fontFamily: sans,
          fontWeight: 700,
          fontSize: 104 * u,
          letterSpacing: -3 * u,
          lineHeight: 1,
          color: 'white',
          textShadow: SHADOW,
          marginBottom: 48 * u,
        }}
      >
        Synced with <span style={{ color: ACCENT, whiteSpace: 'nowrap' }}>Ableton Link</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 18 * u,
          maxWidth: (vertical ? 920 : 1500) * u,
          opacity: v,
        }}
      >
        {LINKED.map((name, i) => {
          const at = start + beat(1 + i * 0.5);
          const pop = spring({ frame: frame - at, fps: FPS, config: { damping: 12, stiffness: 220 } });
          // Each name lands lit, then settles to white.
          const lit = interpolate(frame - at, [0, beat(1)], [1, 0], clamp);
          return (
            <div
              key={name}
              style={{
                opacity: pop,
                transform: `scale(${0.6 + 0.4 * pop})`,
                fontFamily: sans,
                fontWeight: 700,
                fontSize: 42 * u,
                color: 'white',
                padding: `${12 * u}px ${28 * u}px`,
                borderRadius: 999,
                background: 'rgba(0,0,0,0.6)',
                border: `${2 * u}px solid`,
                borderColor: lit > 0.01 ? `rgba(200,255,62,${0.4 + 0.6 * lit})` : 'rgba(255,255,255,0.4)',
                boxShadow: `0 0 ${32 * u * lit}px rgba(200,255,62,${0.6 * lit})`,
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </div>
          );
        })}
      </div>
    </Center>
  );
};

const Fact = ({ index }: { index: number }) => {
  const frame = useCurrentFrame();
  const { u } = useUnit();
  const start = bar(SECTIONS.facts[0] + index * FACT_BARS);
  const v = useShow(start, bar(SECTIONS.facts[0] + (index + 1) * FACT_BARS), beat(0.5));
  if (!v) return null;
  // A slow push in while it holds, so two bars don't feel static.
  const drift = interpolate(frame - start, [0, bar(FACT_BARS)], [0, 0.04], clamp);
  return (
    <Center scrim={v}>
      <div
        style={{
          opacity: v,
          transform: `scale(${1.12 - 0.12 * v + drift})`,
          fontFamily: sans,
          fontWeight: 700,
          fontSize: 120 * u,
          letterSpacing: -3 * u,
          lineHeight: 1,
          color: 'white',
          textShadow: SHADOW,
          maxWidth: 1600 * u,
        }}
      >
        {FACTS[index]}
      </div>
    </Center>
  );
};

/** Which bar and beat we are on: the proof that it is all on the grid. */
const BarCounter = () => {
  const frame = useCurrentFrame();
  const { u } = useUnit();
  const section = sectionAt(frame);
  if (section !== 'facts' && section !== 'drop') return null;
  const t = frame / FPS;
  const n = Math.floor(t / BAR) + 1;
  const b = Math.min(3, Math.floor((t % BAR) / BEAT));
  return (
    <div
      style={{
        position: 'absolute',
        left: 64 * u,
        bottom: 56 * u,
        fontFamily: mono,
        fontSize: 26 * u,
        letterSpacing: 4 * u,
        color: 'white',
        textShadow: SHADOW,
        display: 'flex',
        alignItems: 'center',
        gap: 20 * u,
      }}
    >
      <span>
        BAR {String(n).padStart(2, '0')} / {BARS}
      </span>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 14 * u,
            height: 14 * u,
            borderRadius: '50%',
            background: i === b ? ACCENT : 'rgba(255,255,255,0.3)',
            transform: `scale(${i === b ? 1 + 0.5 * (1 - beatPhase(frame)) : 1})`,
          }}
        />
      ))}
    </div>
  );
};

type Node = { id: string; label: string; sub: string; at: number };
const NODES: Node[] = [
  { id: 'audio', label: 'Audio in', sub: 'any music', at: 1 },
  { id: 'flow', label: 'visual[flow]', sub: 'the engine', at: 2 },
  { id: 'out', label: 'Any display', sub: 'full screen', at: 3.5 },
  { id: 'link', label: 'Ableton Link', sub: 'your whole rig', at: 5 },
];
const EDGES: { from: string; to: string; label: string; at: number }[] = [
  { from: 'audio', to: 'flow', label: 'the music', at: 2.5 },
  { from: 'flow', to: 'out', label: 'live', at: 4 },
  { from: 'link', to: 'flow', label: 'tempo · beat · bar', at: 5.5 },
];

/** The breakdown: how it fits together, a beat at a time. */
const Diagram = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { u, vertical } = useUnit();
  const start = bar(SECTIONS.breakdown[0]);
  const end = bar(SECTIONS.breakdown[1]);
  if (frame < start - beat(0.5) || frame >= end) return null;
  const local = frame - start;
  const out = interpolate(frame, [end - beat(0.5), end], [1, 0], clamp);
  const pos: Record<string, [number, number]> = vertical
    ? { audio: [0.5, 0.36], flow: [0.5, 0.53], out: [0.5, 0.7], link: [0.78, 0.62] }
    : { audio: [0.17, 0.52], flow: [0.5, 0.52], out: [0.83, 0.52], link: [0.5, 0.8] };
  const at = (id: string) => [pos[id][0] * width, pos[id][1] * height] as const;
  const shown = (beats: number) =>
    spring({ frame: local - beat(beats), fps: FPS, config: { damping: 15, stiffness: 180 } }) * out;
  const title = shown(0);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: (vertical ? 0.2 : 0.14) * height,
          width: '100%',
          textAlign: 'center',
          fontFamily: sans,
          fontWeight: 700,
          fontSize: 84 * u,
          letterSpacing: -2 * u,
          color: 'white',
          opacity: title,
          transform: `translateY(${(1 - title) * 30 * u}px)`,
          textShadow: SHADOW,
        }}
      >
        Sound in. Light out.
      </div>
      <svg width={width} height={height} style={{ position: 'absolute' }}>
        {EDGES.map((e) => {
          const [x1, y1] = at(e.from);
          const [x2, y2] = at(e.to);
          const drawn = interpolate(local, [beat(e.at), beat(e.at + 0.75)], [0, 1], {
            ...clamp,
            easing: Easing.out(Easing.cubic),
          });
          // A pulse rides each wire once a beat, once it is drawn.
          const p = beatPhase(frame);
          const live = local >= beat(e.at + 0.75);
          return (
            <g key={e.from + e.to} opacity={out}>
              <line
                x1={x1}
                y1={y1}
                x2={x1 + (x2 - x1) * drawn}
                y2={y1 + (y2 - y1) * drawn}
                stroke="white"
                strokeOpacity={0.7}
                strokeWidth={3 * u}
              />
              {live && (
                <circle cx={x1 + (x2 - x1) * p} cy={y1 + (y2 - y1) * p} r={9 * u} fill={ACCENT} opacity={1 - p * 0.6} />
              )}
              <text
                // Vertical wires carry their label beside them, horizontal ones above.
                x={(x1 + x2) / 2 + (x1 === x2 ? 20 * u : 0)}
                y={(y1 + y2) / 2 + (x1 === x2 ? 8 * u : -18 * u)}
                textAnchor={x1 === x2 ? 'start' : 'middle'}
                fill={ACCENT}
                fontFamily={mono}
                fontSize={24 * u}
                letterSpacing={2 * u}
                stroke="black"
                strokeWidth={7 * u}
                strokeOpacity={0.8}
                paintOrder="stroke"
                opacity={drawn}
              >
                {e.label}
              </text>
            </g>
          );
        })}
      </svg>
      {NODES.map((n) => {
        const v = shown(n.at);
        const [x, y] = at(n.id);
        const lit = n.id === 'flow';
        return (
          <div
            key={n.id}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: `translate(-50%, -50%) scale(${0.85 + 0.15 * v})`,
              opacity: v,
              padding: `${22 * u}px ${36 * u}px`,
              borderRadius: 18 * u,
              border: `${2 * u}px solid ${lit ? ACCENT : 'rgba(255,255,255,0.6)'}`,
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(6px)',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              boxShadow: lit ? `0 0 ${40 * u}px ${ACCENT}55` : undefined,
            }}
          >
            <div style={{ fontFamily: lit ? mono : sans, fontWeight: 700, fontSize: 44 * u, color: 'white' }}>
              {n.label}
            </div>
            <div style={{ fontFamily: mono, fontSize: 20 * u, letterSpacing: 3 * u, color: 'rgba(255,255,255,0.65)' }}>
              {n.sub.toUpperCase()}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** The first bar of the drop. */
const Drop = () => {
  const frame = useCurrentFrame();
  const { u } = useUnit();
  const start = bar(SECTIONS.drop[0]);
  const v = useShow(start, start + bar(1), beat(1));
  if (!v) return null;
  const grow = interpolate(frame - start, [0, bar(1)], [1, 1.12], clamp);
  return (
    <Center scrim={v}>
      <div
        style={{
          fontFamily: sans,
          fontWeight: 700,
          fontSize: 210 * u,
          letterSpacing: -6 * u,
          lineHeight: 0.95,
          color: 'white',
          textShadow: SHADOW,
          opacity: v,
          transform: `scale(${grow + 0.03 * kick(frame)})`,
        }}
      >
        ON THE ONE.
      </div>
    </Center>
  );
};

const Wordmark = () => {
  const frame = useCurrentFrame();
  const { u } = useUnit();
  const start = bar(SECTIONS.outro[0]);
  if (frame < start) return null;
  const word = 'visual[flow]';
  const fade = interpolate(frame, [LENGTH - beat(2), LENGTH - beat(0.5)], [1, 0], clamp);
  const tag = rise(frame, start + beat(3));
  const sub = rise(frame, start + beat(5));
  return (
    <Center style={{ opacity: fade }} scrim={rise(frame, start)}>
      <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 170 * u, textShadow: SHADOW }}>
        {word.split('').map((ch, i) => {
          const v = spring({ frame: frame - start - i * 2, fps: FPS, config: { damping: 13, stiffness: 160 } });
          const bracket = i >= word.indexOf('[');
          return (
            <span
              key={i}
              style={{
                fontFamily: bracket ? mono : sans,
                fontWeight: 700,
                letterSpacing: bracket ? -4 * u : -5 * u,
                color: bracket ? ACCENT : 'white',
                display: 'inline-block',
                opacity: v,
                transform: `translateY(${(1 - v) * 60 * u}px)`,
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: sans,
          fontWeight: 500,
          fontSize: 46 * u,
          color: 'white',
          opacity: tag,
          marginTop: 20 * u,
          textShadow: SHADOW,
        }}
      >
        MilkDrop, rebuilt for the stage.
      </div>
      <div
        style={{
          fontFamily: mono,
          fontSize: 26 * u,
          letterSpacing: 6 * u,
          color: 'rgba(255,255,255,0.75)',
          opacity: sub,
          marginTop: 28 * u,
          textShadow: SHADOW,
        }}
      >
        PART OF OPEN[FLOW]
      </div>
    </Center>
  );
};

/** 0..1 over the beat from `at`. */
const rise = (frame: number, at: number) =>
  interpolate(frame, [at, at + beat(1)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

export const Teaser = () => (
  <AbsoluteFill style={{ backgroundColor: 'black' }}>
    <Footage />
    <Intro />
    {FACTS.map((_, i) => (
      <Fact key={i} index={i} />
    ))}
    <LinkWall />
    <Diagram />
    <Drop />
    <Wordmark />
    <BarCounter />
    <Flash />
  </AbsoluteFill>
);
