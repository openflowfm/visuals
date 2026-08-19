import { useMemo, useState } from 'react';
import type {
  Archetype,
  EffectKind,
  Rule,
  Scheme,
  Show,
  SourceKind,
} from '../../protocol.ts';
import { BLENDS, EFFECT_KINDS, SOURCE_KINDS } from '../../protocol.ts';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Slider } from '../../../widgets/src/controls/Slider.tsx';
import { Toggle } from '../../../widgets/src/controls/Toggle.tsx';
import { Row } from '../../../widgets/src/chrome/Row.tsx';
import '../../../widgets/src/tokens.css';
import { BIAS, ENERGY, FLOOR, MAX_EFFECTS, PERCENT } from './param.ts';
import './editor.css';

/**
 * The scheme, as controls.
 *
 * Built from `widgets/`, which is the first time this repo has used that module
 * outside a device chain — and the point of having it. A knob that knew what an
 * archetype was could not have been written before archetypes existed; one that
 * takes a `Param` and a number was ready. The single adapter is
 * [`param.ts`](./param.ts), the same shape `ui/` has in `lib/liveParam.ts`.
 *
 * **Everything here edits the same file you could edit by hand.** The server
 * writes `scheme.json` on every save, so a show tuned in the browser is one you
 * can read, diff and commit afterwards — the editor is a way of writing the
 * record, not a second place the truth lives.
 *
 * The vocabulary is the *set's*: roles, songs and track names come down on the
 * show, so nothing here asks anyone to type a name. A rule matched against a
 * role that does not exist is invisible until the night it was written for.
 */
export interface EditorProps {
  show: Show;
  scheme: Scheme;
  save(next: Scheme): void;
  onClose(): void;
}

export function Editor({ show, scheme, save, onClose }: EditorProps) {
  const roles = useMemo(() => {
    const all = new Set([...show.roles, ...Object.keys(scheme.archetypes)]);
    return [...all].sort();
  }, [show.roles, scheme.archetypes]);

  // Follow the set when it moves somewhere you have not pinned. Editing a
  // chorus while a chorus is on screen is the whole reason this is a panel over
  // the picture rather than a separate page.
  const [pinned, setPinned] = useState<string | null>(null);
  const role = pinned ?? show.role ?? roles[0] ?? '';
  const archetype: Archetype = scheme.archetypes[role] ?? { energy: scheme.defaults.energy };

  const patch = (next: Partial<Scheme>) => save({ ...scheme, ...next });

  const setArchetype = (next: Partial<Archetype>) =>
    patch({
      archetypes: { ...scheme.archetypes, [role]: { ...archetype, ...next } },
    });

  const setRule = (list: 'tracks' | 'clips', index: number, next: Partial<Rule> | null) => {
    const rules = [...scheme[list]];
    if (next === null) rules.splice(index, 1);
    else rules[index] = { ...rules[index], ...next };
    patch({ [list]: rules } as Partial<Scheme>);
  };

  const colorwayNames = Object.keys(scheme.colorways);
  const song = show.song;
  const assigned = (song && scheme.songs[song]) || scheme.defaults.colorway;

  return (
    <div className="editor wdg">
      <header>
        <h2>scheme</h2>
        <span className="path">scheme.json</span>
        <button type="button" onClick={onClose} aria-label="Close editor">
          ×
        </button>
      </header>

      <div className="scroll">
        <section>
          <h3>
            sections
            <em>{pinned ? 'pinned' : 'following the set'}</em>
          </h3>

          <div className="roles">
            {roles.map((name) => (
              <button
                key={name}
                type="button"
                className="role"
                data-on={name === role ? '' : undefined}
                data-live={name === show.role ? '' : undefined}
                // Clicking the one already shown unpins, so the panel goes back
                // to following the set without a second control to explain.
                onClick={() => setPinned(pinned === name ? null : name)}
                title={
                  show.roles.includes(name)
                    ? `${name} — in the set`
                    : `${name} — defined here, not in the set`
                }
              >
                {name}
                {!show.roles.includes(name) && <i>·</i>}
              </button>
            ))}
          </div>

          <div className="split">
            <Knob
              param={ENERGY}
              value={PERCENT.to(archetype.energy)}
              onChange={(v) => setArchetype({ energy: PERCENT.from(v) })}
              name="Energy"
            />
            <div className="fx">
              {EFFECT_KINDS.map((kind) => {
                const on = (archetype.effects ?? []).includes(kind);
                return (
                  <Toggle
                    key={kind}
                    on={on}
                    width={62}
                    onChange={(next) =>
                      setArchetype({
                        effects: next
                          ? [...(archetype.effects ?? []), kind]
                          : (archetype.effects ?? []).filter((k) => k !== kind),
                      })
                    }
                  >
                    {kind}
                  </Toggle>
                );
              })}
            </div>
          </div>
          <p className="note">
            The section's character. Effects are <b>added</b> to whatever a track or clip
            contributes, and energy decides how many of them actually land — the first opens
            across the bottom of the range, the second across the top.
          </p>
        </section>

        <section>
          <h3>
            colour
            <em>{song ?? 'no song playing'}</em>
          </h3>

          {song ? (
            <Row gap={14}>
              <Select
                items={colorwayNames}
                index={Math.max(0, colorwayNames.indexOf(assigned))}
                onChange={(i) =>
                  patch({ songs: { ...scheme.songs, [song]: colorwayNames[i] } })
                }
                name={`${song}`}
              />
            </Row>
          ) : (
            <p className="note">Fire a clip and this assigns a colourway to whatever is playing.</p>
          )}

          <div className="ways">
            {colorwayNames.map((name) => (
              <div key={name} className="way" data-on={name === show.colorway ? '' : undefined}>
                <span className="wayname">{name}</span>
                {scheme.colorways[name].map((hex, i) => (
                  <input
                    key={i}
                    type="color"
                    value={hex}
                    aria-label={`${name} colour ${i + 1}`}
                    onChange={(e) => {
                      const colors = [...scheme.colorways[name]];
                      colors[i] = e.target.value;
                      patch({ colorways: { ...scheme.colorways, [name]: colors } });
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <p className="note">
            A layer takes one by its depth in the stack. Clip colour is deliberately not an
            input — that is navigation, and it stays yours.
          </p>
        </section>

        <section>
          <h3>
            layers
            <em>{scheme.tracks.length} rules</em>
          </h3>

          {scheme.tracks.map((rule, i) => (
            <RuleEditor
              key={i}
              rule={rule}
              names={show.trackNames}
              onChange={(next) => setRule('tracks', i, next)}
              onRemove={() => setRule('tracks', i, null)}
            />
          ))}
          <button
            type="button"
            className="add"
            onClick={() => patch({ tracks: [...scheme.tracks, { match: '', source: 'solid' }] })}
          >
            + rule
          </button>
          <p className="note">
            First match wins, so <b>order is meaning</b>. Patterns are case-insensitive
            regular expressions — keep the <code>\b</code> word boundaries, or{' '}
            <code>beat</code> matches inside <code>Beating Pad</code>.
          </p>
        </section>

        <section>
          <h3>defaults</h3>
          <Row gap={16}>
            <Knob
              param={ENERGY}
              value={PERCENT.to(scheme.defaults.energy)}
              onChange={(v) => patch({ defaults: { ...scheme.defaults, energy: PERCENT.from(v) } })}
              name="Energy"
            />
            <Knob
              param={MAX_EFFECTS}
              value={scheme.defaults.maxEffects}
              onChange={(v) =>
                patch({ defaults: { ...scheme.defaults, maxEffects: Math.round(v) } })
              }
              name="Max fx"
            />
            <Select
              items={colorwayNames}
              index={Math.max(0, colorwayNames.indexOf(scheme.defaults.colorway))}
              onChange={(i) =>
                patch({ defaults: { ...scheme.defaults, colorway: colorwayNames[i] } })
              }
              name="Fallback"
            />
          </Row>
          <p className="note">
            What a role with no archetype and a song with no colourway fall back to. Nothing
            is ever unstyled — an unassigned song going dark would be a black screen for the
            one thing nobody remembered to configure.
          </p>
        </section>
      </div>
    </div>
  );
}

/** One rule. The same shape for a track rule and a clip rule, because they are one type. */
function RuleEditor({
  rule,
  names,
  onChange,
  onRemove,
}: {
  rule: Rule;
  names: string[];
  onChange(next: Partial<Rule>): void;
  onRemove(): void;
}) {
  // What this rule would actually catch, which is the question a pattern raises
  // and the one a plain text field cannot answer.
  const hits = useMemo(() => {
    if (!rule.match) return [];
    try {
      const test = new RegExp(rule.match, 'i');
      return names.filter((n) => test.test(n));
    } catch {
      return null;
    }
  }, [rule.match, names]);

  return (
    <div className="rule">
      <div className="ruletop">
        <input
          className="match"
          value={rule.match}
          spellCheck={false}
          aria-label="Match pattern"
          onChange={(e) => onChange({ match: e.target.value })}
        />
        <button type="button" className="drop" onClick={onRemove} aria-label="Remove rule">
          ×
        </button>
      </div>

      <Row gap={12}>
        <Select
          items={SOURCE_KINDS}
          index={Math.max(0, SOURCE_KINDS.indexOf(rule.source ?? 'solid'))}
          onChange={(i) => onChange({ source: SOURCE_KINDS[i] as SourceKind })}
          name="Source"
        />
        <Select
          items={['—', ...BLENDS]}
          index={rule.blend ? BLENDS.indexOf(rule.blend) + 1 : 0}
          onChange={(i) => onChange({ blend: i === 0 ? undefined : BLENDS[i - 1] })}
          name="Blend"
        />
        <Knob
          param={BIAS}
          value={PERCENT.to(rule.energyBias ?? 0)}
          onChange={(v) => onChange({ energyBias: v === 0 ? undefined : PERCENT.from(v) })}
          name="Bias"
        />
        <Slider
          param={FLOOR}
          value={PERCENT.to(rule.floor ?? 0)}
          onChange={(v) => onChange({ floor: PERCENT.from(v) })}
          name="Floor"
        />
      </Row>

      <div className="fx small">
        {EFFECT_KINDS.map((kind) => {
          const on = (rule.effects ?? []).includes(kind);
          return (
            <Toggle
              key={kind}
              on={on}
              width={58}
              onChange={(next) =>
                onChange({
                  effects: next
                    ? [...(rule.effects ?? []), kind]
                    : (rule.effects ?? []).filter((k) => k !== kind),
                })
              }
            >
              {kind}
            </Toggle>
          );
        })}
      </div>

      <p className={`hits${hits === null ? ' bad' : hits.length === 0 ? ' none' : ''}`}>
        {hits === null
          ? 'not a valid pattern — this rule is skipped'
          : hits.length === 0
            ? 'matches nothing in this set'
            : `${hits.length}: ${hits.join(', ')}`}
      </p>
    </div>
  );
}

export type { EffectKind };
