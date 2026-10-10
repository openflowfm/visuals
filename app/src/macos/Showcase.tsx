import { useState, type ReactNode } from 'react';
import { MAC_SIZES, type MacSize } from './controls.tsx';
import './showcase.css';

/**
 * The sheet the macOS stories lay their controls out on: every size against
 * every state, in light and dark side by side, each on the window's
 * background. Where the kit's exported pictures are at `kit/out/` (see
 * `kit/README.md`; Storybook serves them at `kit/` when the folder is there),
 * each cell shows the kit's picture of the same variant beside ours.
 */

export type Appearance = 'light' | 'dark';
export const APPEARANCES: readonly Appearance[] = ['light', 'dark'];

/** Where a control is shown: idle, pressed (`:active`, through the pseudo-states addon), disabled, or in a window that isn't key. */
export type Column = 'idle' | 'pressed' | 'disabled' | 'inactive' | 'inactive-disabled';
export const COLUMNS: readonly Column[] = ['idle', 'pressed', 'disabled', 'inactive', 'inactive-disabled'];

export const COLUMN_NAMES: Record<Column, string> = {
  idle: 'Idle',
  pressed: 'Pressed',
  disabled: 'Disabled',
  inactive: 'Inactive window',
  'inactive-disabled': 'Inactive, disabled',
};

export const SIZE_NAMES: Record<MacSize, string> = { mini: 'Mini', small: 'Small', regular: 'Regular', large: 'Large', xlarge: 'Extra large' };

/** The kit's own names for the sizes, as its symbol paths have them. */
export const KIT_SIZES: Record<MacSize, string> = { mini: '1 Mn', small: '2 Sm', regular: '3 Rg', large: '4 Lg', xlarge: '5 XL' };

/** The kit's names for the appearances. */
export const KIT_APPEARANCES: Record<Appearance, string> = { light: 'Light', dark: 'Dark' };

/** The kit's names for the states its symbols end with ("1 - Idle"…), or none where it has no picture. */
export const KIT_STATES: Record<Column, string | null> = {
  idle: '1 - Idle',
  pressed: '3 - Clicked',
  disabled: '4 - Disabled',
  inactive: '1 - Idle',
  'inactive-disabled': '4 - Disabled',
};

/** Whether the column is in a window that isn't key. */
export const isInactive = (column: Column) => column === 'inactive' || column === 'inactive-disabled';
/** Whether the column's control is disabled. */
export const isDisabled = (column: Column) => column === 'disabled' || column === 'inactive-disabled';

/** The pseudo-states addon's parameters that hold the pressed column's controls down. */
export const PRESSED = { pseudo: { active: ['[data-column="pressed"] > :first-child'] } };

/** The kit's picture of a symbol (its path, as `kit/out/` has it), at half its @2x size; nothing when it isn't there. */
export function KitPicture({ symbol }: { symbol: string | null }) {
  const [missing, setMissing] = useState(false);
  const [width, setWidth] = useState<number>();
  if (!symbol || missing) return null;
  const src = `kit/${symbol.split('/').map(encodeURIComponent).join('/')}${encodeURIComponent('@2x.png')}`;
  return (
    <img
      className="mac-kit-picture"
      src={src}
      alt=""
      title={`The kit's ${symbol}`}
      style={width ? { width } : { visibility: 'hidden', width: 0 }}
      onLoad={(e) => setWidth(e.currentTarget.naturalWidth / 2)}
      onError={() => setMissing(true)}
    />
  );
}

interface SheetProps {
  /** Our control for a size and a column (disabled where `isDisabled`); the cell puts the inactive ones in `.mac-inactive`. */
  render: (size: MacSize, column: Column) => ReactNode;
  /** The kit's symbol for an appearance, size and column, or null where the kit has none. */
  kit?: (appearance: Appearance, size: MacSize, column: Column) => string | null;
  columns?: readonly Column[];
}

/** Every size against every column, light beside dark. Each appearance is a region named "Light" or "Dark"; each cell a group named "<size>, <column>". */
export function Sheet({ render, kit, columns = COLUMNS }: SheetProps) {
  return (
    <div className="mac-sheet">
      {APPEARANCES.map((appearance) => (
        <section key={appearance} className="mac-window" data-appearance={appearance} aria-label={KIT_APPEARANCES[appearance]}>
          <table className="mac-sheet-table">
            <thead>
              <tr>
                <th />
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {COLUMN_NAMES[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MAC_SIZES.map((size) => (
                <tr key={size}>
                  <th scope="row">{SIZE_NAMES[size]}</th>
                  {columns.map((column) => (
                    <td key={column}>
                      <div className={isInactive(column) ? 'mac-cell mac-inactive' : 'mac-cell'} data-column={column} role="group" aria-label={`${SIZE_NAMES[size]}, ${COLUMN_NAMES[column]}`}>
                        {render(size, column)}
                        <KitPicture symbol={kit?.(appearance, size, column) ?? null} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

/** A few controls, light beside dark, for a playground story; a function gets the appearance (to name a group apart in each). */
export function Pair({ children }: { children: ReactNode | ((appearance: Appearance) => ReactNode) }) {
  return (
    <div className="mac-sheet">
      {APPEARANCES.map((appearance) => (
        <section key={appearance} className="mac-window mac-pair" data-appearance={appearance} aria-label={KIT_APPEARANCES[appearance]}>
          {typeof children === 'function' ? children(appearance) : children}
        </section>
      ))}
    </div>
  );
}
