import { useEffect, useRef, useState, type ReactNode } from 'react';
import './controls.css';

/**
 * macOS's toggles and disclosure button, drawn as the macOS 27 kit draws them
 * (its "Content Area" controls), on the kit's tokens (`kit/tokens.css`).
 * A reference to build the app's own controls from: nothing in the app uses
 * them yet. Each sits in light or dark from the nearest `data-appearance`
 * (or the system's), and greys as macOS does in a window that isn't key when
 * an ancestor has the class `mac-inactive`.
 */

/** The kit's five control sizes: mini, small, regular, large, extra large. */
export type MacSize = 'mini' | 'small' | 'regular' | 'large' | 'xlarge';
export const MAC_SIZES: readonly MacSize[] = ['mini', 'small', 'regular', 'large', 'xlarge'];

/** A checkbox's or radio button's value: on, off, or mixed (some of what it stands for is on). */
export type MacToggleValue = boolean | 'mixed';

interface ToggleProps {
  /** The label beside the box; without one, give `aria-label`. */
  children?: ReactNode;
  'aria-label'?: string;
  size?: MacSize;
  disabled?: boolean;
  /** Controlled; leave it out to let the input keep its own state, starting from `defaultChecked`. */
  checked?: MacToggleValue;
  defaultChecked?: MacToggleValue;
  /** The input's new state: true or false (a click always ends mixed). */
  onChange?: (checked: boolean) => void;
  name?: string;
  value?: string;
}

/** The check, on a 16-unit box: it scales with the box. */
function Check() {
  return (
    <svg className="mac-toggle-mark mac-toggle-check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.6 8.4 7 10.75 11.4 5.3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The mixed state's dash: 6.5 by 2 on the regular box. */
function Dash() {
  return (
    <svg className="mac-toggle-mark mac-toggle-dash" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.75" y="7" width="6.5" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

/**
 * A checkbox: a real `<input type="checkbox">` laid over the box we draw, so
 * Space, the label, forms and assistive tech work as they do natively. Mixed is
 * its `indeterminate`, which reads as "mixed"; clicking a mixed box checks it.
 * What is drawn follows the input (`:checked`, `:indeterminate`), never a copy of it.
 */
export function MacCheckbox({ children, size = 'regular', disabled, checked, defaultChecked = false, onChange, name, value, 'aria-label': label }: ToggleProps) {
  const input = useRef<HTMLInputElement>(null);
  const controlled = checked !== undefined;
  // Mixed has no attribute: it is set on the element, from the prop each render, or once from the default.
  useEffect(() => {
    if (input.current && controlled) input.current.indeterminate = checked === 'mixed';
  });
  useEffect(() => {
    // Only the first value counts, as for defaultChecked.
    if (input.current && !controlled) input.current.indeterminate = defaultChecked === 'mixed';
  }, []);
  return (
    <label className="mac-toggle mac-checkbox" data-size={size} data-disabled={disabled ? '' : undefined}>
      <span className="mac-toggle-box">
        <input
          ref={input}
          className="mac-toggle-input"
          type="checkbox"
          name={name}
          value={value}
          aria-label={label}
          disabled={disabled}
          {...(controlled ? { checked: checked === true } : { defaultChecked: defaultChecked === true })}
          onChange={(e) => onChange?.(e.currentTarget.checked)}
        />
        <Check />
        <Dash />
      </span>
      {children !== undefined && <span className="mac-toggle-label">{children}</span>}
    </label>
  );
}

/**
 * A radio button: a real `<input type="radio">`, so a group sharing `name`
 * moves with the arrow keys and keeps one checked, drawn from `:checked`.
 * HTML's radios have no mixed state, so mixed (the kit's dash) is drawn only,
 * until the radio is picked: the input reads as not checked.
 */
export function MacRadio({ children, size = 'regular', disabled, checked, defaultChecked = false, onChange, name, value, 'aria-label': label }: ToggleProps) {
  const controlled = checked !== undefined;
  const [ownMixed, setOwnMixed] = useState(defaultChecked === 'mixed');
  const mixed = controlled ? checked === 'mixed' : ownMixed;
  return (
    <label className="mac-toggle mac-radio" data-size={size} data-mixed={mixed ? '' : undefined} data-disabled={disabled ? '' : undefined}>
      <span className="mac-toggle-box">
        <input
          className="mac-toggle-input"
          type="radio"
          name={name}
          value={value}
          aria-label={label}
          disabled={disabled}
          {...(controlled ? { checked: checked === true } : { defaultChecked: defaultChecked === true })}
          onChange={(e) => {
            setOwnMixed(false);
            onChange?.(e.currentTarget.checked);
          }}
        />
        <span className="mac-radio-dot" aria-hidden="true" />
        <Dash />
      </span>
      {children !== undefined && <span className="mac-toggle-label">{children}</span>}
    </label>
  );
}

/** Controlled with `value`, or on its own from `initial`. */
function useValue(value: boolean | undefined, initial: boolean, onChange?: (next: boolean) => void): [boolean, (next: boolean) => void] {
  const [own, setOwn] = useState(initial);
  const current = value ?? own;
  return [
    current,
    (next) => {
      if (value === undefined) setOwn(next);
      onChange?.(next);
    },
  ];
}

interface SwitchProps {
  /** What it turns on: the kit's switches carry no label of their own. */
  'aria-label': string;
  size?: MacSize;
  disabled?: boolean;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}

/** A switch: a button with `role="switch"`, so Space or Enter flips it as a click does. The knob rests at the trailing end when on. */
export function MacSwitch({ size = 'regular', disabled, checked, defaultChecked = false, onChange, 'aria-label': label }: SwitchProps) {
  const [on, set] = useValue(checked, defaultChecked, onChange);
  return (
    <button type="button" role="switch" className="mac-switch" data-size={size} aria-label={label} aria-checked={on} disabled={disabled} onClick={() => set(!on)}>
      <span className="mac-switch-knob" aria-hidden="true" />
    </button>
  );
}

interface DisclosureProps {
  /** What it shows or hides. */
  'aria-label': string;
  size?: MacSize;
  disabled?: boolean;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onChange?: (expanded: boolean) => void;
  /** The id of what it shows or hides. */
  controls?: string;
}

/** The disclosure button: a small rounded square with a chevron, down when closed and up when open. */
export function MacDisclosure({ size = 'regular', disabled, expanded, defaultExpanded = false, onChange, controls, 'aria-label': label }: DisclosureProps) {
  const [open, set] = useValue(expanded, defaultExpanded, onChange);
  return (
    <button type="button" className="mac-disclosure" data-size={size} aria-label={label} aria-expanded={open} aria-controls={controls} disabled={disabled} onClick={() => set(!open)}>
      <svg className="mac-disclosure-chevron" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.4 4.4 6 8 9.6 4.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
