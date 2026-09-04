import { Facts, type Fact } from '@openflow/widgets/debug/Facts.tsx';
import { Group, Harness, Shelf, Status, Toolbar } from '@openflow/widgets/debug/Harness.tsx';
import type { Show } from '../../protocol.ts';

/**
 * Which of the four is missing.
 *
 * A rig that shows nothing looks the same whichever link in the chain is
 * broken, and the chain is longer here than anywhere else in the suite: Live
 * has to be running, the bridge has to have reached it, the LOM has to have
 * been read, Link has to have been joined, and a scheme has to have compiled.
 * Five things, one black screen.
 *
 * So they are listed in the order they have to happen, each saying what it is
 * waiting on rather than only whether it is true. The first bad line is the one
 * to fix; the ones under it are consequences and say so.
 */

export function Wiring({ show, glError }: { show: Show; glError: string | null }) {
  const chain: Fact[] = [
    {
      name: 'bridge',
      value: show.connected ? 'connected' : 'not connected',
      tone: show.connected ? 'good' : 'bad',
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
      status={broken ? <Status tone="bad">{broken.name} first</Status> : <Status tone="good">all five</Status>}
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
