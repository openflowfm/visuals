import './numbers.css';

/** `text` with its numbers ("7 of 9,795") in the numbers' face. */
export function Numbers({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,.]*(?: of \d[\d,.]*)?)/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <span key={i} className="numbers">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
