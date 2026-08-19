import type { Archetype, Scheme, Show } from '../../protocol.ts';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { EffectPicks } from './EffectPicks.tsx';
import { ENERGY, PERCENT } from './param.ts';

/**
 * Archetypes: what a section *is*, bound to the roles the set already names.
 *
 * The vocabulary here is the bridge's. A role is a `[CHORUS]` prefix on a scene,
 * so it travels in the `.als` and is already the thing the band talks in — which
 * is why nothing on this pane asks anyone to type a name. A role defined here
 * but absent from the set is marked rather than hidden, because that is exactly
 * the mistake worth seeing: an archetype for a section that will never arrive.
 */
export function Sections({
  show,
  scheme,
  patch,
  pinned,
  setPinned,
}: {
  show: Show;
  scheme: Scheme;
  patch(next: Partial<Scheme>): void;
  pinned: string | null;
  setPinned(next: string | null): void;
}) {
  const roles = [...new Set([...show.roles, ...Object.keys(scheme.archetypes)])].sort();
  const role = pinned ?? show.role ?? roles[0] ?? '';
  const archetype: Archetype = scheme.archetypes[role] ?? {
    energy: scheme.defaults.energy,
  };

  const setArchetype = (next: Partial<Archetype>) =>
    patch({
      archetypes: { ...scheme.archetypes, [role]: { ...archetype, ...next } },
    });

  return (
    <>
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
              // Clicking the one already shown unpins, so the panel goes back to
              // following the set without a second control to explain.
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
          {roles.length === 0 && <p className="note">No scene in this set names a role yet.</p>}
        </div>

        {role && (
          <>
            <div className="split">
              <Knob
                param={ENERGY}
                value={PERCENT.to(archetype.energy)}
                onChange={(v) => setArchetype({ energy: PERCENT.from(v) })}
                name="Energy"
              />
              <EffectPicks
                scheme={scheme}
                chosen={archetype.effects}
                onChange={(effects) => setArchetype({ effects })}
              />
            </div>
            <p className="note">
              Energy is the whole of what a section is. It sets how fast every layer reacts, how
              bright and hard-edged it sits, how much of the stack is admitted, and how far the
              effects below are dialled in — so a chorus is the same picture pushed somewhere else
              rather than a different one.
            </p>
          </>
        )}
      </section>

      <section>
        <h3>
          right now
          <em>{show.song ?? 'nothing playing'}</em>
        </h3>
        <dl className="reading">
          <dt>section</dt>
          <dd>
            {show.role ?? '—'}
            {show.role && !show.archetype ? ' — no archetype' : ''}
          </dd>
          <dt>energy</dt>
          <dd>{Math.round(show.energy * 100)}%</dd>
          <dt>colourway</dt>
          <dd>{show.colorway ?? '—'}</dd>
          <dt>layers drawing</dt>
          <dd>
            {show.layers.filter((l) => l.playing >= 0 && l.opacity > 0.001).length} of{' '}
            {show.layers.length}
          </dd>
        </dl>
      </section>
    </>
  );
}
