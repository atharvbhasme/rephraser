import { describe, expect, it } from 'vitest';
import { applyFixes } from '../src/lib/applyFixes';
import type { Issue } from '../src/lib/issues';
import { makeContext, postProcess } from '../src/lib/rules';
import { runRules } from '../src/lib/rules/custom';
import { isAcronym, isIdentifier, protectedRanges } from '../src/lib/rules/protect';
import { editDistance, isDialectVariant, isSentenceStart } from '../src/lib/rules/text';

const ctx = makeContext(['Rahul', 'Pame', 'SQLite', 'kubectl']);
const fix = (text: string, rules?: string[]) => applyFixes(text, runRules({ text, ctx, unknown: new Set() }, rules)).corrected;

describe('protected text', () => {
  it('recognises identifiers, acronyms, links and code', () => {
    for (const t of ['lastRunAt', 'error.message', 'GRAPHQL_ENDPOINT', 'p95', 'Auth0', 'release_v7.10.2']) expect(isIdentifier(t)).toBe(true);
    for (const t of ['tomorrow', '9th', 'e.g.', 'Rahul']) expect(isIdentifier(t)).toBe(false);
    expect(isAcronym('KDP')).toBe(true);
    expect(isAcronym("RU's")).toBe(true);
    expect(isAcronym('I')).toBe(false);
    const text = 'See https://x.io/a and `getTime()` in src/app.ts';
    const covered = protectedRanges(text).map((r) => text.slice(r.start, r.end));
    expect(covered).toEqual(expect.arrayContaining(['https://x.io/a', '`getTime()`', 'src/app.ts']));
  });
});

describe('text helpers', () => {
  it('measures edit distance with transpositions', () => {
    expect(editDistance('avaliable', 'available')).toBe(1);
    expect(editDistance('tommorow', 'tomorrow')).toBe(2);
  });
  it('knows sentence starts, ignoring "Dr."', () => {
    const t = 'I met Dr. Pompole. He was kind.';
    expect(isSentenceStart(t, t.indexOf('Pompole'))).toBe(false);
    expect(isSentenceStart(t, t.indexOf('He'))).toBe(true);
  });
  it('treats US/UK spellings as variants', () => {
    expect(isDialectVariant('center', 'centre')).toBe(true);
    expect(isDialectVariant('defenses', 'defences')).toBe(true);
    expect(isDialectVariant('color', 'colour')).toBe(true);
    expect(isDialectVariant('form', 'from')).toBe(false);
  });
});

describe('rules', () => {
  it('fixes greetings', () => {
    expect(fix('hi, Rahul I have sent it', ['greeting'])).toBe('Hi Rahul, I have sent it');
    expect(fix('hi, rahul and pame\nbelow are the details', ['greeting'])).toBe('Hi Rahul and Pame,\nbelow are the details');
    expect(fix('Hi, For this release', ['greeting'])).toBe('Hi, For this release'); // "For" isn't a name
  });

  it('ends sentences, asks questions and leaves lists alone', () => {
    expect(fix('we will see fewer errors once it reaches production', ['end-punctuation'])).toBe(
      'we will see fewer errors once it reaches production.',
    );
    expect(fix('can we ask the team to confirm the details', ['end-punctuation'])).toBe('can we ask the team to confirm the details?');
    expect(fix('- update the runbook with new flags', ['end-punctuation'])).toBe('- update the runbook with new flags');
    expect(fix('Memory Utilization: 17.6%', ['end-punctuation'])).toBe('Memory Utilization: 17.6%');
    expect(fix('I am leaving home at\n10 AM tomorrow morning', ['end-punctuation'])).toBe('I am leaving home at\n10 AM tomorrow morning.');
  });

  it('capitalises the start of a line', () => {
    expect(fix('can we start now', ['line-start-capital'])).toBe('Can we start now');
    expect(fix('npm run build --watch', ['line-start-capital'])).toBe('npm run build --watch');
  });

  it('fixes "have send", "is require" and past time with "have"', () => {
    expect(fix('I have send you the request', ['have-participle'])).toBe('I have sent you the request');
    expect(fix('The token is require for login', ['have-participle'])).toBe('The token is required for login');
    expect(fix('We have test cases', ['have-participle'])).toBe('We have test cases'); // noun
    expect(fix('I have to go now', ['have-participle'])).toBe('I have to go now');
    expect(fix('Last sprint we have added new alerts.', ['past-time'])).toBe('Last sprint we added new alerts.');
    expect(fix('We have added new alerts.', ['past-time'])).toBe('We have added new alerts.');
    expect(fix('Last sprint we have added alerts, I have informed the team.', ['past-time'])).toBe(
      'Last sprint we added alerts, I have informed the team.',
    );
  });

  it('pluralises after numbers only when it is not a compound', () => {
    expect(fix('It has been 2 month since then', ['plural'])).toBe('It has been 2 months since then');
    expect(fix("after 2 month's of waiting", ['plural'])).toBe('after 2 months of waiting');
    expect(fix('those environment variables', ['plural'])).toBe('those environment variables');
  });

  it('adds missing articles in safe places only', () => {
    expect(fix('I added the details in runbook.', ['article'])).toBe('I added the details in the runbook.');
    expect(fix('I will book appointment today.', ['article'])).toBe('I will book an appointment today.');
    expect(fix('We need to change the plan.', ['article'])).toBe('We need to change the plan.');
    expect(fix('It was fixed in ticket ME-1234.', ['article'])).toBe('It was fixed in ticket ME-1234.');
    expect(fix('I will reach office at home time.', ['article'])).toBe('I will reach office at home time.');
  });

  it('splits sentences joined by a comma before a capital', () => {
    expect(fix('These are the multitenancy changes, We have not added details', ['comma-capital'])).toBe(
      'These are the multitenancy changes. We have not added details',
    );
    expect(fix('Hi Rahul, We are ready', ['comma-capital'])).toBe('Hi Rahul, We are ready');
  });

  it('fixes he/she/it + verb', () => {
    expect(fix('yes, it work for me', ['third-person'])).toBe('yes, it works for me');
    expect(fix('he have the file', ['third-person'])).toBe('he has the file');
    expect(fix('please make it work today', ['third-person'])).toBe('please make it work today');
    expect(fix('will it work?', ['third-person'])).toBe('will it work?');
  });

  it('capitalises dictionary names typed in lower case', () => {
    expect(fix('I told rahul and pame', ['name-capital'])).toBe('I told Rahul and Pame');
    expect(fix('see rahul.dev and @pame', ['name-capital'])).toBe('see rahul.dev and @pame');
  });

  it('fixes "Thank You" and "Please Update"', () => {
    expect(fix('Thank You!', ['thank-you'])).toBe('Thank you!');
    expect(fix('Please Update the version', ['please-lowercase'])).toBe('Please update the version');
  });
});

describe('postProcess', () => {
  const harper = (text: string, problem: string, kind: string, replacement: string): Issue => {
    const start = text.indexOf(problem);
    return {
      id: `${start}`,
      index: 0,
      start,
      end: start + problem.length,
      kind,
      category: kind === 'Spelling' ? 'spelling' : 'grammar',
      message: '',
      problem,
      suggestions: [{ kind: 'replace', text: replacement }],
    };
  };

  it('drops corrections of code, acronyms and links', () => {
    const t = 'Check lastRunAt in KDP';
    const out = postProcess(t, [harper(t, 'lastRunAt', 'Spelling', 'astronaut'), harper(t, 'KDP', 'Spelling', 'Kip')], ctx, { rules: [] });
    expect(out).toEqual([]);
  });

  it('prefers dictionary casing and only auto-applies safe spelling fixes', () => {
    const t = 'I told pame about it and Naveen agreed tommorow';
    const out = postProcess(
      t,
      [harper(t, 'pame', 'Spelling', 'pace'), harper(t, 'Naveen', 'Spelling', "Nave's"), harper(t, 'tommorow', 'Spelling', 'tomorrow')],
      ctx,
      { rules: [] },
    );
    expect(applyFixes(t, out).corrected).toBe('I told Pame about it and Naveen agreed tomorrow');
    expect(out.find((i) => i.problem === 'Naveen')?.auto).toBe(false); // shown, not applied
  });

  it('fixes an unknown name in a greeting but still offers "Add to dictionary"', () => {
    const t = 'hi, saurabh I have checked it';
    const out = postProcess(t, [harper(t, 'saurabh', 'Spelling', 'sour')], makeContext([]), { rules: ['greeting'] });
    expect(applyFixes(t, out).corrected).toBe('Hi Saurabh, I have checked it');
    const name = out.find((i) => i.problem === 'saurabh');
    expect(name?.category).toBe('spelling');
    expect(name?.suggestions[0].text).toBe('Saurabh');
  });

  it('lets the greeting win over a confident-looking wrong guess for a name', () => {
    const t = 'hi, naveen I have checked it';
    const out = postProcess(t, [harper(t, 'naveen', 'Spelling', "nave's")], makeContext([]), { rules: ['greeting'] });
    expect(applyFixes(t, out).corrected).toBe('Hi Naveen, I have checked it');
  });

  it('never auto-splits words or expands abbreviations', () => {
    const t = 'Update the runbook, FYI';
    const out = postProcess(t, [harper(t, 'runbook', 'Typo', 'run book'), harper(t, 'FYI', 'Miscellaneous', 'For your information')], ctx, {
      rules: [],
    });
    expect(applyFixes(t, out).corrected).toBe(t);
  });
});
