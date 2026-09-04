import { useMemo } from 'react';
import { Rooms, type Room } from '@openflow/widgets/debug/Rooms.tsx';
import { useRemembered } from '@openflow/widgets/debug/useRemembered.ts';
import type { Show } from '../../protocol.ts';
import type { Clock } from '../state/useShow.ts';
import type { FrameStats } from '../render/meter.ts';
import { Frames } from './Frames.tsx';
import { Beat } from './Beat.tsx';
import { Wiring } from './Wiring.tsx';

/**
 * What is wrong, when the picture is wrong.
 *
 * The console already answers "did it connect". This answers the questions
 * after that one, which are the ones a show asks at the worst moment: is the
 * clock moving in time or drifting, is the renderer late and by how much, and
 * which of the four things behind the picture is not there.
 *
 * Rooms rather than one row of tabs, because this will grow the way mix[flow]'s
 * did — the clock alone has phase, tempo, quantum, peers and drift in it, and
 * each of those is a drawing before it is a number.
 *
 * Add a component and one entry. The widgets never learn what an experiment is.
 */

export interface Subject {
  show: Show;
  clock: Clock;
  frames: FrameStats | null;
  glError: string | null;
}

const ROOMS: readonly Room<Subject>[] = [
  {
    id: 'render',
    title: 'Render',
    note: 'what the GPU is doing',
    experiments: [
      {
        id: 'frames',
        title: 'Frames',
        description:
          'What the compositor measured over its last window. A late frame on a projector is the one thing an audience can see, so the share is the number to read rather than the average.',
        component: ({ context }) => <Frames frames={context.frames} glError={context.glError} />,
      },
    ],
  },
  {
    id: 'time',
    title: 'Time',
    note: 'the clock the show runs on',
    experiments: [
      {
        id: 'beat',
        title: 'Beat',
        description:
          'Link beats as they arrive, drawn against the wall clock. A clock that is running steadily draws a straight ramp; a clock that is being corrected draws the correction.',
        component: ({ context }) => <Beat clock={context.clock} show={context.show} />,
      },
    ],
  },
  {
    id: 'wiring',
    title: 'Wiring',
    note: 'what is and is not there',
    experiments: [
      {
        id: 'wiring',
        title: 'Wiring',
        description:
          'The four things behind a picture — Live, the bridge, Link, the scheme — and which of them is missing. A rig that shows nothing gives no clue which one it was.',
        component: ({ context }) => <Wiring show={context.show} glError={context.glError} />,
      },
    ],
  },
];

export function DebugWorkspace({ subject }: { subject: Subject }) {
  const [room, setRoom] = useRemembered('visuals-room', ROOMS[0].id);
  const [tab, setTab] = useRemembered('visuals-tab', ROOMS[0].experiments[0].id);
  const rooms = useMemo(() => ROOMS, []);
  return (
    <Rooms
      rooms={rooms}
      context={subject}
      room={room}
      tab={tab}
      onRoom={setRoom}
      onTab={setTab}
    />
  );
}
