/**
 * The full correction pipeline after Harper: protect code/links, refine Harper's issues,
 * then add Rephraser's own rules. Pure function, used by the worker and the benchmark.
 */
import type { Issue } from '../issues';
import type { RuleContext } from './context';
import { runRules } from './custom';
import { overlaps, protectedRanges } from './protect';
import { refineHarperIssues } from './refine';

export { makeContext, EMPTY_CONTEXT, type RuleContext } from './context';

/** The range an issue's default fix actually edits (an insertion edits a single point). */
function editRange(i: Issue): [number, number] {
  return i.suggestions[0]?.kind === 'insertAfter' ? [i.end, i.end] : [i.start, i.end];
}

function conflicts(a: Issue, b: Issue): boolean {
  const [as, ae] = editRange(a);
  const [bs, be] = editRange(b);
  if (as === ae && bs === be) return as === bs;
  if (as === ae) return as > bs && as < be;
  if (bs === be) return bs > as && bs < ae;
  return as < be && bs < ae;
}

/** Rules that know a word is a name: they beat Harper's spelling guess for that word. */
const NAME_RULES = new Set(['rule:greeting', 'rule:name-capital']);

export function postProcess(
  text: string,
  harperIssues: Issue[],
  ctx: RuleContext,
  options: { rules?: string[]; ignored?: Set<string> } = {},
): Issue[] {
  const prot = protectedRanges(text);
  const unknown = new Set(harperIssues.filter((i) => i.category === 'spelling').map((i) => i.problem));
  const refined = refineHarperIssues(text, harperIssues, ctx, prot).map((i) => ({ ...i, source: i.source ?? `harper:${i.kind}` }));
  const extra = runRules({ text, ctx, unknown }, options.rules).filter(
    (i) => !overlaps(prot, i.start, i.end) && !(i.ignoreKey && options.ignored?.has(i.ignoreKey)),
  );
  const merged: Issue[] = [...refined];
  for (const r of extra) {
    // Harper's issue wins on the same words, unless it's only a low-confidence guess.
    // Style hints never block a real fix.
    const clash = merged.find((h) => h.category !== 'style' && conflicts(h, r));
    if (!clash) merged.push(r);
    else if (
      clash.category === 'spelling' &&
      clash.start === r.start &&
      clash.end === r.end &&
      (clash.auto === false || NAME_RULES.has(r.source ?? ''))
    ) {
      // An unknown word that a rule knows how to fix (a name in a greeting): use the rule's fix,
      // but keep it a spelling issue so "Add to dictionary" is still offered.
      const fix = r.suggestions[0];
      merged.splice(merged.indexOf(clash), 1, {
        ...clash,
        message: `${r.message} Add it to your dictionary so it's never flagged.`,
        suggestions: [fix, ...clash.suggestions.filter((s) => s.text !== fix.text)],
        auto: true,
        source: r.source,
      });
    } else if (clash.auto === false && clash.category !== 'spelling') merged.splice(merged.indexOf(clash), 1, r);
  }
  return merged.sort((a, b) => a.start - b.start || a.end - b.end);
}
