import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { Layer, Opaque } from '@satoramoto/zen';
import { FX_BUSY } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { EffectSettings, Hit, useFx } from './Effects';

/** The effects' rows as ⚙ Settings' Effects section shows them, on the sheet's opaque overlay, read from the app. */
function Section() {
  const { state, set } = useFx();
  return (
    <Opaque>
      <Layer level="overlay" style={{ width: 400, padding: 20, borderRadius: 'var(--radius-card)' }}>
        {state ? <EffectSettings state={state} set={set} /> : <p role="status">Reading the effects…</p>}
      </Layer>
    </Opaque>
  );
}

/**
 * The effects' settings (no original story: they were seen only inside Settings): the strobe's
 * rate and colour as words, the fade to black, and brightness and sensitivity with their steps.
 */
const meta = {
  title: 'open[flow]/visuals/Sheets/Effects',
  component: Section,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof Section>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Every effect at rest. A step up brightens by one fine step. */
export const AtRest: Story = {
  play: async () => {
    await expect(await screen.findByRole('radiogroup', { name: 'flashes per beat' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Brightness up a step' }));
    await waitFor(() => expect(screen.getByRole('slider', { name: 'brightness' })).toHaveAttribute('aria-valuetext', '1.02'));
  },
};

/** Mid-set. */
export const MidSet: Story = {
  parameters: { world: { fx: FX_BUSY } },
};

/** A held hit (More effects' Punch): lit while held. */
export const Punch: StoryObj = {
  render: () => <Hit kind="punch" on={false} hold label="Punch" keyName="P" send={fn()} />,
};
