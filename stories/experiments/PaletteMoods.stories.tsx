import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { fn } from 'storybook/test';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { COLOR_ROLES, MOODS, MOOD_ABOUT, type Mood } from '../../protocol.ts';
import { newSeed, palette, seeded } from '../../randomize.ts';

type Args = { deals: number; seed: string; reDeal(): void };

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
function Moods({ deals, seed, reDeal }: Args) {
  const seeds = Array.from({ length: deals }, (_, i) => `${seed}:${i}`);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Button onPress={reDeal}>{'⚄'} re-deal</Button>
        <span className="swatch-hex">seed {seed}</span>
      </div>
      {MOODS.map((mood) => (
        <MoodRow key={mood} mood={mood} seeds={seeds} />
      ))}
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

/** The seed is an arg, so the re-deal button writes a fresh one back to the controls. */
const live = (args: Args) => {
  const [, setArgs] = useArgs<Args>();
  return (
    <Moods
      {...args}
      reDeal={() => {
        args.reDeal();
        setArgs({ seed: newSeed() });
      }}
    />
  );
};

const meta = {
  title: 'Experiments/Palette moods',
  component: Moods,
  render: live,
  args: { deals: 3, seed: 'storybook', reDeal: fn() },
  argTypes: {
    deals: { control: { type: 'range', min: 1, max: 8, step: 1 } },
    seed: { control: 'text' },
    reDeal: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "An experiment: what does each mood actually deal? The generator's document says what a mood is for; this is the page that shows whether it does that.",
      },
    },
  },
} satisfies Meta<typeof Moods>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryMood: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'One row a mood, dealt from the same seeds, so a column is the same random draw judged under six different rules. Every swatch is labelled with the role it was dealt to. The seed is an arg, so a page re-opens on the same draw and the die deals a new one.',
      },
    },
  },
};
