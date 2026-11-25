/** Lists the most frequent edits in the AI references (what a corrector should learn to do). */
import { it } from 'vitest';
import { loadCases } from './datasets';
import { classify, diff, tokenize } from './metrics';

it('frequent reference edits', () => {
  const counts = new Map<string, number>();
  for (const c of loadCases().filter((x) => x.pure)) {
    const a = tokenize(c.input);
    const b = tokenize(c.reference);
    for (const e of diff(a, b)) {
      const t = classify(e, new Set());
      if (t === 'rewrite') continue;
      const ctx = `${a[e.i1 - 1] ?? '^'} [${e.del.join(' ')}→${e.ins.join(' ')}] ${a[e.i2] ?? '$'}`;
      const key = `${t === 'spelling' ? 'word form / choice' : t} | ${e.del.join(' ') || '∅'} → ${e.ins.join(' ') || '∅'}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      counts.set(`CTX ${t} | ${ctx}`, (counts.get(`CTX ${t} | ${ctx}`) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].filter(([k]) => !k.startsWith('CTX')).sort((x, y) => y[1] - x[1]).slice(0, 90);
  console.log(top.map(([k, n]) => `${n}\t${k}`).join('\n'));
  const ctx = [...counts.entries()].filter(([k]) => k.startsWith('CTX missing')).sort((x, y) => y[1] - x[1]).slice(0, 70);
  console.log('\n--- missing-word contexts ---\n' + ctx.map(([k, n]) => `${n}\t${k.slice(4)}`).join('\n'));
});
