import { Text } from '@satoramoto/zen';
import './Numbers.css';

/**
 * **Job.** `text` with its numbers ("7 of 9,795") in the numbers' face.
 *
 * **Changed.** The class is `vs-numbers` (was `numbers`), on the contract's `--font-readout`
 * (was `--font-num` and its axes): the instrument faces' readout is Instrument Sans, so the
 * figures stay in the UI's face with tabular numerals (principles, Type). Each number is a body
 * `Text` at its line's size (`size="inherit"`), so it sets the body weight and leading: it sits
 * in body-weight lines (the hero's and the transport's "from").
 *
 * **Kept.** The split (a number, optionally "of" another), the export and its one prop.
 */
export function Numbers({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,.]*(?: of \d[\d,.]*)?)/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <Text key={i} size="inherit" tabular className="vs-numbers">
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}
