export interface Sentence {
  text: string;
  start: number;
  end: number;
  /** Whitespace that follows the sentence, kept so the text can be rebuilt exactly. */
  trailing: string;
}

/** Splits text into sentences (with offsets) using the browser's built-in segmenter. */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const pieces: { segment: string; index: number }[] = Seg
    ? Array.from(new Seg('en', { granularity: 'sentence' }).segment(text))
    : fallbackSplit(text);

  for (const p of pieces) {
    const trimmedEnd = p.segment.replace(/\s+$/, '');
    const lead = p.segment.length - p.segment.trimStart().length;
    const body = trimmedEnd.slice(lead);
    if (!body) {
      // Pure whitespace: attach to the previous sentence's trailing space.
      if (out.length) out[out.length - 1].trailing += p.segment;
      continue;
    }
    if (lead && out.length) out[out.length - 1].trailing += p.segment.slice(0, lead);
    out.push({
      text: body,
      start: p.index + lead,
      end: p.index + lead + body.length,
      trailing: p.segment.slice(lead + body.length),
    });
  }
  return out;
}

function fallbackSplit(text: string): { segment: string; index: number }[] {
  const re = /[^.!?]+[.!?]*\s*/g;
  const out: { segment: string; index: number }[] = [];
  for (const m of text.matchAll(re)) out.push({ segment: m[0], index: m.index ?? 0 });
  return out;
}

/** Like joinSentences, but also returns where each sentence ended up in the result. */
export function joinWithRanges(
  sentences: Sentence[],
  replacements: Record<number, string> = {},
  leading = '',
): { text: string; ranges: { start: number; end: number }[] } {
  let text = leading;
  const ranges = sentences.map((s, i) => {
    const body = replacements[i] ?? s.text;
    const start = text.length;
    text += body;
    const range = { start, end: text.length };
    text += s.trailing;
    return range;
  });
  return { text, ranges };
}

/** Rebuilds text from sentences, using a replacement for any sentence index given. */
export function joinSentences(sentences: Sentence[], replacements: Record<number, string> = {}, leading = ''): string {
  return leading + sentences.map((s, i) => (replacements[i] ?? s.text) + s.trailing).join('');
}
