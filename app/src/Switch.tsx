import { MacSwitch } from './macos/controls.tsx';
import './switch.css';

/**
 * A setting that is on or off, as one line: its name, and macOS's switch at the
 * end of the line (`MacSwitch`, `role="switch"`), lit in the suite's colour.
 * The name labels the switch, so a click on it flips it too. Drawn in the dark
 * appearance whatever macOS's is, as the page always is.
 */
export function SwitchRow({
  name,
  on,
  onChange,
  disabled = false,
  title,
  className,
}: {
  name: string;
  on: boolean;
  onChange(on: boolean): void;
  disabled?: boolean;
  /** What it does, as a tooltip over the whole line. */
  title?: string;
  className?: string;
}) {
  return (
    <label className={`vf-switch${className ? ` ${className}` : ''}`} data-appearance="dark" data-disabled={disabled ? '' : undefined} title={title}>
      <span className="vf-switch-name">{name}</span>
      <MacSwitch aria-label={name} size="small" checked={on} onChange={onChange} disabled={disabled} />
    </label>
  );
}
