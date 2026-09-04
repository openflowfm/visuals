import { Facts, type Fact } from '@openflow/widgets/debug/Facts.tsx';
import { Group, Harness, Shelf, Status, Toolbar } from '@openflow/widgets/debug/Harness.tsx';
import type { Show } from '../../protocol.ts';

/**
 * Which of the four is missing.
 *
 * A rig that shows nothing looks the same whichever link in the chain is
 * broken, and the chain is longer here than anywhere else in the suite: this
 * app's own server has to be up, the bridge has to have reached Live, the LOM
 * has to have been read, Link has to have been joined, and a scheme has to have
 * compiled. Six things, one black screen.
 *
 * The server was missing from this list until somebody ran the UI without it,
 * read a harness that said nothing about it, and had to guess. The first link
 * in a chain is exactly the one a chain is most likely to be missing, and the
 * one an app is least likely to think of, because it is the app.
 *
 * So they are listed in the order they have to happen, each saying what it is
 * waiting on rather than only whether it is true. The first bad line is the one
 * to fix; the ones under it are consequences and say so.
 */

export function Wiring({
  show,
  glError,
  online,
}: {
  show: Show;
  glError: string | null;
  online: boolean;
}) {
  const chain: Fact[] = [
    {
      name: 'server',
      value: online ? 'up' : 'not running',
      tone: online ? 'good' : 'bad',
      title: 'This app’s own server — run npm run dev:visuals',
    },
    {
      name: 'bridge',
      value: show.connected ? 'connected' : online ? 'not connected' : 'nothing to connect through',
      tone: show.connected ? 'good' : online ? 'bad' : 'quiet',
      title: 'The socket to the device in Live',
    },
    {
      name: 'live',
      value: show.lomReady ? 'read' : show.connected ? 'waiting on the LOM' : 'nothing to read',
      tone: show.lomReady ? 'good' : show.connected ? 'bad' : 'quiet',
      title: 'Whether the session has been walked',
    },
    {
      name: 'link',
      value: show.clock ? `joined, ${show.peers} peer${show.peers === 1 ? '' : 's'}` : 'not joined',
      tone: show.clock ? 'good' : 'bad',
      title: 'Link says when; the bridge says what',
    },
    {
      name: 'scheme',
      value: show.schemeError ? show.schemeError : show.flow ? 'compiled' : 'none chosen',
      tone: show.schemeError ? 'bad' : show.flow ? 'good' : 'quiet',
    },
    {
      name: 'context',
      value: glError ?? 'holding',
      tone: glError ? 'bad' : 'good',
      title: 'The graphics context, which can be lost and come back',
    },
  ];

  const state: Fact[] = [
    { name: 'playing', value: show.playing ? 'yes' : 'stopped', tone: show.playing ? 'good' : 'quiet' },
    { name: 'song', value: show.song ?? '—', tone: show.song ? 'normal' : 'quiet' },
    { name: 'key', value: show.key ?? '—', tone: show.key ? 'normal' : 'quiet' },
    { name: 'colorway', value: show.colorway ?? '—', tone: show.colorway ? 'normal' : 'quiet' },
    { name: 'tracks', value: show.tracks.length },
    { name: 'master', value: show.master.toFixed(3), tone: 'quiet' },
  ];

  // The first thing in the chain that is not there is the thing to go and fix.
  const broken = chain.find((one) => one.tone === 'bad');

  return (
    <Harness
      title="Wiring"
      status={broken ? <Status tone="bad">{broken.name} first</Status> : <Status tone="good">all six</Status>}
    >
      <Toolbar>
        <Group caption="In the order it has to happen">
          <Status tone="quiet">the first bad line is the one to fix</Status>
        </Group>
      </Toolbar>
      <Shelf>
        <Facts items={chain} />
      </Shelf>
      <Shelf>
        <Facts items={state} />
      </Shelf>
    </Harness>
  );
}
