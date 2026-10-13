// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LiveState } from '../model/live-model';
import { EFFECTS_PANEL_ID, EffectsPanel } from './EffectsPanel';

const live = { intensity: 0.5, setIntensity: () => {} } as unknown as LiveState;

describe('EffectsPanel focus', () => {
  it('opened by the Effects button, focus moves to its first pad', () => {
    render(<EffectsPanel live={live} onClose={() => {}} focusOnOpen />);
    const panel = document.getElementById(EFFECTS_PANEL_ID)!;
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.closest('.vs-effects-panel-hold')).not.toBeNull();
  });

  it('opened by E, focus stays where it was', () => {
    render(<EffectsPanel live={live} onClose={() => {}} />);
    expect(document.getElementById(EFFECTS_PANEL_ID)!.contains(document.activeElement)).toBe(false);
  });
});
