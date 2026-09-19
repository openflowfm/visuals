import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { COLOR_ROLES, MOODS, MOOD_ABOUT, type Mood } from '../../protocol.ts';
import { newSeed, palette, seeded } from '../../randomize.ts';

/**
 * An experiment: what does each mood actually deal?
 *
 * The generator's document says what a mood is for; this is the page that
 * shows whether it does that. Six rows, one a mood, each dealt a handful of
 * palettes from the same seeds — so the rows differ only in the mood, and
 * pressing the die re-deals every row from a fresh seed at once.
 *
 * Kept because the question comes back every time `MOOD_RULES` changes.
 */
function Moods({ deals }: { deals: number }) {
  const [seed, setSeed] = useState('storybook');
  const seeds = Array.from({ length: deals }, (_, i) => `${seed}:${i}`);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Button onPress={() => setSeed(newSeed())}>{'⚄'} re-deal</Button>
        <span className="swatch-hex">seed {seed}</span>
      </div>
      {MOODS.map((mood) => (
        <MoodRow key={mood} mood={mood} seeds={seeds} />
      ))}
      <p className="sb-note">
        One row a mood, dealt from the same seeds, so a column is the same random draw judged
        under six different rules. Every swatch is labelled with the role it was dealt to.
      </p>
    </div>
  );
}

function MoodRow({ mood, seeds }: { mood: Mood; seeds: string[] }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="swatch-row-name" title={MOOD_ABOUT[mood]} style={{ marginBottom: 4 }}>
        {mood} <span className="swatch-hex">— {MOOD_ABOUT[mood]}</span>
      </div>
      {seeds.map((seed) => {
        const dealt = palette(seeded(seed), mood);
        return (
          <div key={seed} className="swatch-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {dealt.map((hex, i) => (
              <div key={COLOR_ROLES[i]} className="swatch" style={{ background: hex }} title={hex}>
                {COLOR_ROLES[i]}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const meta = {
  title: 'Experiments/Palette moods',
  component: Moods,
  args: { deals: 3 },
  argTypes: { deals: { control: { type: 'range', min: 1, max: 8, step: 1 } } },
} satisfies Meta<typeof Moods>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryMood: Story = {};
