import { useState } from 'react';
import type { EffectDef, Scheme, Show, SourceKind } from '../../protocol.ts';
import { SOURCE_KINDS } from '../../protocol.ts';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Row } from '../../../widgets/src/chrome/Row.tsx';
import { CircuitEditor } from './Circuit.tsx';
import { Preview } from './Preview.tsx';
import { addCircuit, dropEffect, effectList } from './edits.ts';
import { effectShader } from '../render/effect.ts';
import { BUILTIN_PARAMS } from '../render/shaders.ts';
import { AMOUNT, ENERGY, PERCENT, effectParam } from './param.ts';
import type { Clock } from '../state/useShow.ts';

/**
 * The effects themselves, apart from anywhere they are used.
 *
 * The cascade says *which* effect a section or a layer contributes and how far
 * energy dials it in. It has nothing to say about what a kaleidoscope is, and
 * that separation is why this pane exists: an effect is a thing with its own
 * settings, tuned once, and reached by name from everywhere.
 *
 * A built-in is a handwritten shader with a few declared knobs. A circuit is
 * the same thing wired out of nodes on a canvas, and the compositor cannot tell
 * them apart — which is the point. Both are addressed by id, so an archetype
 * naming one has no idea which kind it got.
 */
export function Effects({
  show,
  scheme,
  patch,
  save,
  clock,
}: {
  show: Show;
  scheme: Scheme;
  patch(next: Partial<Scheme>): void;
  save(next: Scheme): void;
  clock: Clock;
}) {
  const list = effectList(scheme);
  const [selected, setSelected] = useState<string>(list[0]?.id ?? '');
  const [source, setSource] = useState<SourceKind>('grid');
  const [amount, setAmount] = useState(1);
  const [energy, setEnergy] = useState(0.7);
  const [glError, setGlError] = useState<string | null>(null);

  const id = scheme.effects[selected] ? selected : (list[0]?.id ?? '');
  const def: EffectDef | null = scheme.effects[id] ?? null;
  const failed = def ? effectShader(def).error : null;

  const setDef = (next: Partial<EffectDef>) =>
    patch({ effects: { ...scheme.effects, [id]: { ...def!, ...next } } });

  // The colourway of whatever is playing, so an effect is judged against the
  // colours it will actually meet rather than against a stand-in white.
  const colors = scheme.colorways[show.colorway ?? scheme.defaults.colorway] ?? ['#3cc8ff'];

  return (
    <>
      <section>
        <h3>
          bench
          <em>{def?.name ?? 'nothing selected'}</em>
        </h3>
        <Preview
          def={def}
          source={source}
          amount={amount}
          energy={energy}
          color={pack(colors[0])}
          quantum={show.quantum || 4}
          clock={clock}
          onError={setGlError}
        />
        <Row gap={14}>
          <Select
            items={SOURCE_KINDS}
            index={Math.max(0, SOURCE_KINDS.indexOf(source))}
            onChange={(i) => setSource(SOURCE_KINDS[i])}
            name="Under it"
          />
          <Knob
            param={AMOUNT}
            value={PERCENT.to(amount)}
            onChange={(v) => setAmount(PERCENT.from(v))}
            name="Amount"
          />
          <Knob
            param={ENERGY}
            value={PERCENT.to(energy)}
            onChange={(v) => setEnergy(PERCENT.from(v))}
            name="Energy"
          />
        </Row>
        <p className="note">
          The bench is on Link's beat, so anything wired to the clock is in time with the room while
          you build it. Amount and energy are the bench's own — on stage the cascade decides both.
        </p>
      </section>

      <section>
        <h3>
          effects
          <em>{list.length}</em>
        </h3>
        <div className="roles">
          {list.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="role"
              data-on={entry.id === id ? '' : undefined}
              data-wired={entry.def.circuit ? '' : undefined}
              onClick={() => setSelected(entry.id)}
            >
              {entry.def.name || entry.id}
            </button>
          ))}
          <button
            type="button"
            className="add"
            onClick={() => {
              const next = addCircuit(scheme);
              save(next.scheme);
              setSelected(next.id);
            }}
          >
            + circuit
          </button>
        </div>
      </section>

      {def && (
        <section>
          <h3>
            {def.circuit ? 'circuit' : 'built in'}
            <em>{id}</em>
          </h3>

          <div className="line">
            <input
              className="field"
              value={def.name}
              spellCheck={false}
              aria-label="Effect name"
              onChange={(e) => setDef({ name: e.target.value })}
            />
            {def.circuit && (
              <button
                type="button"
                className="tick warn"
                onClick={() => {
                  save(dropEffect(scheme, id));
                  setSelected('');
                }}
              >
                delete
              </button>
            )}
          </div>

          {def.builtin && (
            <>
              <Row gap={14}>
                {(BUILTIN_PARAMS[def.builtin] ?? []).map((spec) => (
                  <Knob
                    key={spec.name}
                    param={effectParam(spec)}
                    value={def.params?.[spec.name] ?? spec.value}
                    onChange={(v) => setDef({ params: { ...def.params, [spec.name]: v } })}
                    name={spec.name}
                  />
                ))}
              </Row>
              <p className="note">
                Energy still moves underneath these — a chorus adds segments to a kaleidoscope
                whatever the knob says. What you are setting is where it starts from, for every
                layer that uses it.
              </p>
            </>
          )}

          {def.circuit && (
            <CircuitEditor circuit={def.circuit} onChange={(circuit) => setDef({ circuit })} />
          )}

          {(failed || glError) && <p className="hits bad">{failed ?? glError}</p>}
        </section>
      )}
    </>
  );
}

function pack(hex: string): number {
  const value = Number.parseInt(hex.replace(/^#/, ''), 16);
  return Number.isFinite(value) ? value & 0xffffff : 0xffffff;
}
