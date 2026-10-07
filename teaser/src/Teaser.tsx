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
import { bar, beat, beatPhase, DROP_CUTS, FPS, kick, LENGTH, SECTIONS, sectionAt } from './timing';

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
  // Hidden behind the 2001 window until it has grown to fill the frame, then the same
  // preset in HD on the downbeat.
  const i0 = bar(SECTIONS.intro[0]);
  const open = interpolate(frame, [i0 - beat(0.25), i0 + beat(0.125)], [0, 1], clamp);
  const close = interpolate(frame, [LENGTH - beat(2), LENGTH], [1, 0], clamp);
  // Darker under the name, so its lines read over a bright preset.
  const outro = interpolate(frame, [bar(SECTIONS.outro[0]), bar(SECTIONS.outro[0] + 0.5)], [1, 0.32], clamp);
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

/** White on the burst and the drop, and a glint on each preset change after them. */
const Flash = () => {
  const frame = useCurrentFrame();
  const since = (at: number) => (frame >= at ? Math.exp(-(frame - at) / 10) : 0);
  let v = Math.max(since(bar(SECTIONS.drop[0])), 0.6 * since(bar(SECTIONS.intro[0])));
  for (let b = SECTIONS.facts[0] + 1; b < SECTIONS.facts[1]; b++) v = Math.max(v, 0.12 * since(bar(b)));
  for (const b of DROP_CUTS.slice(1)) v = Math.max(v, 0.2 * since(bar(b)));
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
    {/* Positioned, so the text paints above the pool (which is positioned too) rather than under it. */}
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {children}
    </div>
  </AbsoluteFill>
);

/**
 * The cold open: MilkDrop as people first saw it, in a little window on a 2001 desktop,
 * drawn at 320x240 and blown up with its pixels showing. A generic Windows-era window,
 * not Winamp's own skin or logo, which are theirs.
 */
const Origin = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { u, vertical } = useUnit();
  const end = bar(SECTIONS.origin[1]);
  if (frame >= end + beat(0.5)) return null;
  const growFrom = bar(SECTIONS.origin[1] - 1);
  const boot = spring({ frame, fps: FPS, config: { damping: 16, stiffness: 120 } });
  // Then: the year and what it was, either side of the little window.
  const then = interpolate(frame, [growFrom - beat(0.75), growFrom], [1, 0], clamp);
  const year = rise(frame, beat(1)) * then;
  const line = rise(frame, bar(1)) * then;
  // Now: over the last bar the window grows until its picture fills the frame, the desktop
  // goes dark, and on the downbeat the same preset turns from pixels into HD.
  const cover = Math.max(width / (768 * u), height / (576 * u)) * 1.04;
  const grow = interpolate(frame, [growFrom, end - beat(0.25)], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const later = rise(frame, growFrom + beat(0.5)) * interpolate(frame, [end - beat(0.5), end], [1, 0], clamp);
  const gone = interpolate(frame, [end - beat(0.125), end + beat(0.25)], [0, 1], clamp);
  const bevel = (light: string, dark: string) =>
    `inset ${2 * u}px ${2 * u}px 0 ${light}, inset -${2 * u}px -${2 * u}px 0 ${dark}`;
  const caption = (v: number, text: string, style: CSSProperties) => (
    <div
      style={{
        position: 'absolute',
        width: '100%',
        textAlign: 'center',
        color: 'white',
        opacity: v,
        textShadow: SHADOW,
        ...style,
      }}
    >
      {text}
    </div>
  );
  return (
    <AbsoluteFill>
      {/* A 2001 desktop: flat teal, going dark as the window takes over. */}
      <AbsoluteFill style={{ backgroundColor: '#008080', opacity: boot * (1 - grow) * (1 - gone) }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          opacity: boot * (1 - gone),
          transform: `scale(${(0.9 + 0.1 * boot) * (1 + (cover - 1) * grow)})`,
          background: '#c0c0c0',
          padding: 4 * u,
          boxShadow: `${bevel('#ffffff', '#404040')}, 0 ${20 * u}px ${60 * u}px rgba(0,0,0,0.6)`,
        }}
      >
        <div
          style={{
            height: 30 * u,
            background: 'linear-gradient(90deg, #000080, #1084d0)',
            color: 'white',
            fontFamily: 'Tahoma, Verdana, sans-serif',
            fontWeight: 700,
            fontSize: 18 * u,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `0 ${4 * u}px 0 ${8 * u}px`,
            marginBottom: 4 * u,
          }}
        >
          <span>MilkDrop</span>
          <span style={{ display: 'flex', gap: 3 * u }}>
            {['_', '□', '×'].map((g) => (
              <span
                key={g}
                style={{
                  width: 22 * u,
                  height: 20 * u,
                  background: '#c0c0c0',
                  color: 'black',
                  fontSize: 14 * u,
                  lineHeight: `${20 * u}px`,
                  textAlign: 'center',
                  boxShadow: bevel('#ffffff', '#404040'),
                }}
              >
                {g}
              </span>
            ))}
          </span>
        </div>
        <OffthreadVideo
          src={staticFile('origin.mp4')}
          muted
          style={{ display: 'block', width: 768 * u, height: 576 * u, imageRendering: 'pixelated' }}
        />
      </div>
      </AbsoluteFill>
      {caption(year, '2001', {
        top: (vertical ? 0.24 : 0.035) * height,
        fontFamily: mono,
        fontWeight: 700,
        fontSize: 64 * u,
        letterSpacing: 8 * u,
      })}
      {caption(line, 'MilkDrop Lights Up Winamp', {
        bottom: (vertical ? 0.24 : 0.035) * height,
        fontFamily: sans,
        fontWeight: 700,
        fontSize: 60 * u,
        letterSpacing: -2 * u,
      })}
      <Center scrim={later}>
        <div
          style={{
            fontFamily: sans,
            fontWeight: 700,
            fontSize: 120 * u,
            letterSpacing: -3 * u,
            color: 'white',
            opacity: later,
            transform: `scale(${1.08 - 0.08 * later})`,
            textShadow: SHADOW,
          }}
        >
          25 Years Later
        </div>
      </Center>
    </AbsoluteFill>
  );
};

const Intro = () => {
  const { u } = useUnit();
  const [i0, i1] = SECTIONS.intro.map(bar);
  const first = useShow(i0 + beat(1), i1);
  const second = useShow(i0 + beat(4), i1);
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
      {line(first, 'Your Music')}
      {line(second, 'Made Visible', ACCENT)}
    </Center>
  );
};

/** Big lines, two bars each: long enough to read while the presets change under them. */
const FACT_BARS = 2;
const FACTS = ['9,744 Community Presets', 'Native on the GPU'];

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
          const at = start + beat(1 + i * 0.75);
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

type Node = { id: string; label: string; sub: string; at: number };
const NODES: Node[] = [
  { id: 'audio', label: 'Audio In', sub: 'any music', at: 1 },
  // Not the product's name yet: that is held back for the end.
  { id: 'flow', label: 'MilkDrop', sub: 'rebuilt native', at: 2.5 },
  { id: 'out', label: 'Any Display', sub: 'full screen', at: 4.5 },
  { id: 'link', label: 'Ableton Link', sub: 'your whole rig', at: 7 },
];
const EDGES: { from: string; to: string; label: string; at: number }[] = [
  { from: 'audio', to: 'flow', label: 'the music', at: 3 },
  { from: 'flow', to: 'out', label: 'live', at: 5 },
  { from: 'link', to: 'flow', label: 'tempo · beat · bar', at: 7.5 },
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
        Sound In. Light Out.
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
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 44 * u, color: 'white' }}>
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

/** The drop's first bar: SHOW TIME slams in on the one, then the presets have the screen. */
const Drop = () => {
  const frame = useCurrentFrame();
  const { u, vertical } = useUnit();
  const start = bar(SECTIONS.drop[0]);
  const v = useShow(start, start + bar(1), beat(0.75));
  if (!v) return null;
  const pop = spring({ frame: frame - start, fps: FPS, config: { damping: 11, stiffness: 260 } });
  const grow = interpolate(frame - start, [0, bar(1)], [1, 1.1], clamp);
  return (
    <Center scrim={v}>
      <div
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          gap: (vertical ? 0 : 0.28) * 230 * u,
          fontFamily: sans,
          fontWeight: 700,
          fontSize: 230 * u,
          letterSpacing: -4 * u,
          lineHeight: 0.95,
          color: 'white',
          textShadow: SHADOW,
          opacity: v * Math.min(1, pop * 2),
          transform: `scale(${(1.6 - 0.6 * pop) * (grow + 0.03 * kick(frame))})`,
        }}
      >
        <span>SHOW</span>
        <span>TIME</span>
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
  // Four bars: the name, its line a half-bar later, the suite a bar after that, the
  // address after that, then a hold so the last screen can be read.
  const tag = rise(frame, start + beat(2));
  const sub = rise(frame, start + beat(5));
  const site = rise(frame, start + beat(8));
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
        MilkDrop Rebuilt for the Stage
      </div>
      <div
        style={{
          fontFamily: sans,
          fontWeight: 500,
          fontSize: 40 * u,
          color: 'rgba(255,255,255,0.85)',
          opacity: sub,
          transform: `translateY(${(1 - sub) * 20 * u}px)`,
          marginTop: 56 * u,
          textShadow: SHADOW,
        }}
      >
        Part of the <span style={{ fontFamily: mono, fontWeight: 700, color: ACCENT }}>open[flow]</span> Suite
      </div>
      <div
        style={{
          fontFamily: mono,
          fontWeight: 700,
          fontSize: 44 * u,
          letterSpacing: 2 * u,
          color: 'white',
          opacity: site,
          transform: `translateY(${(1 - site) * 20 * u}px)`,
          marginTop: 40 * u,
          padding: `${10 * u}px ${28 * u}px`,
          borderRadius: 999,
          border: `${2 * u}px solid ${ACCENT}`,
          background: 'rgba(0,0,0,0.5)',
        }}
      >
        openflow.fm
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
    <Origin />
    <Intro />
    {FACTS.map((_, i) => (
      <Fact key={i} index={i} />
    ))}
    <LinkWall />
    <Diagram />
    <Drop />
    <Wordmark />
    <Flash />
  </AbsoluteFill>
);
