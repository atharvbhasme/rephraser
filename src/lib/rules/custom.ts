/**
 * Rephraser's own grammar rules, for mistakes Harper doesn't catch. Each one targets a
 * pattern that is frequent in real messages and was checked against the accuracy
 * benchmark (`npm run eval`) to make sure it rarely fires wrongly.
 */
import { categorize, type Issue, type Suggestion } from '../issues';
import type { RuleContext } from './context';
import { isIdentifier } from './protect';
import { capitalize, isListItem, lines, plural, regularParticiple, stripListMarker } from './text';

/** Words that can follow a plural noun without it being a compound ("those environment variables"). */
const AFTER_PLURAL = new Set([
  'of', 'in', 'on', 'for', 'to', 'from', 'with', 'at', 'by', 'ago', 'before', 'after', 'back', 'later', 'earlier', 'now',
  'is', 'are', 'was', 'were', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'need', 'needs', 'may',
  'might', 'must', 'and', 'or', 'but', 'so', 'that', 'which', 'who', 'where', 'when', 'because', 'since', 'until',
  'per', 'each', 'left', 'more', 'only', 'already', 'also', 'still', 'too', 'remaining', 'passed', 'gone',
]);

export interface RuleInput {
  text: string;
  ctx: RuleContext;
  /** Words Harper doesn't know (flagged as misspelled), e.g. unknown names. */
  unknown: Set<string>;
}

type Rule = (input: RuleInput) => Issue[];

function issue(
  rule: string,
  text: string,
  start: number,
  end: number,
  kind: string,
  message: string,
  suggestions: Suggestion[],
  auto = true,
): Issue {
  const problem = text.slice(start, end);
  return {
    id: `r:${rule}:${start}:${end}`,
    index: -1,
    start,
    end,
    kind,
    category: categorize(kind),
    message,
    problem,
    suggestions,
    auto,
    source: `rule:${rule}`,
    ignoreKey: `${rule}|${text.slice(Math.max(0, start - 20), end + 20)}`,
  };
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/* ------------------------------------------------------------------------------------ */
/* Greetings: "hi, rahul I have…" → "Hi Rahul, I have…"                                  */
/* ------------------------------------------------------------------------------------ */
const GREETING =
  /^([ \t]*)(hi|hello|hey|dear)(\s*,\s*|[ \t]+)([\p{L}][\p{L}'’-]*)((?:[ \t]+(?:and|&)[ \t]+[\p{L}][\p{L}'’-]*)*)((?:[ \t]*[,!.:])?)/gimu;
const GROUP_WORDS = /^(team|all|everyone|guys|folks|there)$/i;

const greeting: Rule = ({ text, ctx, unknown }) => {
  const out: Issue[] = [];
  for (const m of text.matchAll(GREETING)) {
    const [, indent, greet, sep, first, more, trail] = m;
    const lineStart = m.index! + indent.length;
    const nameRe = /[\p{L}][\p{L}'’-]*/gu;
    // Every name with its position: "rahul and pame" → [rahul, pame].
    const names: { word: string; start: number }[] = [{ word: first, start: lineStart + greet.length + sep.length }];
    const moreStart = names[0].start + first.length;
    for (const n of more.matchAll(nameRe)) if (!/^and$/i.test(n[0])) names.push({ word: n[0], start: moreStart + n.index! });
    const isName = (w: string) => ctx.names.has(w.toLowerCase()) || GROUP_WORDS.test(w) || unknown.has(w);
    if (!names.every((n) => isName(n.word))) continue;

    // 1. "hi, " → "Hi "
    const head = text.slice(lineStart, names[0].start);
    const fixedHead = `${capitalize(greet.toLowerCase())} `;
    if (head !== fixedHead) {
      out.push(
        issue('greeting', text, lineStart, names[0].start, 'Punctuation', `Write the greeting as “${fixedHead.trim()} ${names.map((n) => capitalize(n.word)).join(' and ')},”.`, [
          { kind: 'replace', text: fixedHead },
        ]),
      );
    }
    // 2. Names start with a capital letter.
    for (const n of names) {
      const fixed = ctx.canonical.get(n.word.toLowerCase()) ?? capitalize(n.word);
      if (fixed === n.word) continue;
      out.push(
        issue('greeting', text, n.start, n.start + n.word.length, 'Capitalization', `Names start with a capital letter: “${fixed}”.`, [
          { kind: 'replace', text: fixed },
        ]),
      );
    }
    // 3. A comma after the name(s): "Hi Rahul, I have…"
    const last = names[names.length - 1];
    const lastEnd = last.start + last.word.length;
    const punct = trail.trim();
    if (punct === ',' || punct === '!') continue;
    if (punct) {
      const pStart = text.indexOf(punct, lastEnd);
      out.push(issue('greeting', text, pStart, pStart + 1, 'Punctuation', 'Use a comma after the name in a greeting.', [{ kind: 'replace', text: ',' }]));
    } else {
      out.push(issue('greeting', text, last.start, lastEnd, 'Punctuation', 'Add a comma after the name in a greeting.', [{ kind: 'insertAfter', text: ',' }]));
    }
  }
  return out;
};

/* ------------------------------------------------------------------------------------ */
/* End-of-sentence punctuation for lines that stop without . ? or :                     */
/* ------------------------------------------------------------------------------------ */
// A question: "can we …", "could you …", "is this …", "what is …", "how do we …".
const QUESTION_START =
  /^(?:(?:can|could|would|will|should|shall|do|does|did|is|are|am|was|were|have|has)\s+(?:i|we|you|he|she|it|they|this|that|these|those|there|someone|anyone|somebody|anybody|the|a|an|my|our|your|their)\b|(?:what|why|how|when|where|which|who)\s+(?:is|are|was|were|do|does|did|can|could|should|would|will|shall|have|has)\b)/i;
// Words a sentence can't end on: the sentence continues on the next line.
const DANGLING = /\b(?:at|the|a|an|to|of|for|and|or|but|with|in|on|by|from|as|is|are|was|were|be|my|our|your|their|this|that|these|those|than|then|if|when|because|so)$/i;
const SIGN_OFF = /^(?:hi|hello|hey|dear|thanks|thank you|regards|best regards|kind regards|cheers|cc|best)\b/i;

const endPunctuation: Rule = ({ text }) => {
  const out: Issue[] = [];
  const all = lines(text);
  let inFence = false;
  all.forEach((line, i) => {
    if (/^\s*```/.test(line.text)) inFence = !inFence;
    if (inFence) return;
    const content = line.text.replace(/\s+$/, '');
    // Bullet points and numbered lines are usually left without a full stop.
    if (isListItem(content)) return;
    const body = content.trimStart();
    const words = body.match(WORD_RE) ?? [];
    if (words.length < 4) return;
    const lastWord = [...content.matchAll(WORD_RE)].pop();
    // The line must end with a word (not "17.6%", a link, a bracket …).
    if (!lastWord || lastWord.index! + lastWord[0].length !== content.length || isIdentifier(lastWord[0])) return;
    if (SIGN_OFF.test(body) && words.length <= 5) return;
    // "Label: value" lines and table rows.
    if (/:\s|\t|\|/.test(body)) return;
    // The sentence continues on the next line.
    const following = all[i + 1]?.text ?? '';
    if (DANGLING.test(content) || /^\s*[\p{Ll}\d]/u.test(following)) return;
    // Short Title Case lines are headings.
    const caps = words.filter((w) => /^\p{Lu}/u.test(w)).length;
    if (words.length <= 8 && caps / words.length >= 0.6) return;
    const next = all[i + 1]?.text ?? '';
    const lastClause = body.split(/[.!?;]\s+|,\s+/).pop() ?? body;
    const isQuestion = QUESTION_START.test(body) || /^(?:could|can|would|will) you\b/i.test(lastClause) || QUESTION_START.test(lastClause);
    const punct = isListItem(next) && /\b(?:below|following|these|follows)\s*$/i.test(body) ? ':' : isQuestion ? '?' : '.';
    const start = line.start + lastWord.index!;
    const end = start + lastWord[0].length;
    const message =
      punct === '?' ? 'This is a question — end it with a question mark.' : punct === ':' ? 'Add a colon before the list.' : 'End the sentence with a full stop.';
    out.push(issue('end-punctuation', text, start, end, 'Punctuation', message, [{ kind: 'insertAfter', text: punct }]));
  });
  return out;
};

/* ------------------------------------------------------------------------------------ */
/* Capital letter at the start of a line: "can we ask…" → "Can we ask…"                  */
/* ------------------------------------------------------------------------------------ */
const lineStartCapital: Rule = ({ text }) => {
  const out: Issue[] = [];
  for (const line of lines(text)) {
    const { body, offset } = stripListMarker(line.text);
    const lead = body.length - body.trimStart().length;
    const m = /^([a-z][a-z']*)(?=[\s,!.?:]|$)/.exec(body.trimStart());
    if (!m) continue;
    const words = body.match(WORD_RE) ?? [];
    if (words.length < 2 || /--|=|\(\)|=>|;\s*$/.test(body)) continue; // looks like a command or code
    const start = line.start + offset + lead;
    out.push(
      issue('line-start-capital', text, start, start + m[1].length, 'Capitalization', 'Start the sentence with a capital letter.', [
        { kind: 'replace', text: capitalize(m[1]) },
      ]),
    );
  }
  return out;
};

/* ------------------------------------------------------------------------------------ */
/* "Thank You" → "Thank you"                                                              */
/* ------------------------------------------------------------------------------------ */
const thankYou: Rule = ({ text }) =>
  [...text.matchAll(/\bThank You\b/g)].map((m) =>
    issue('thank-you', text, m.index!, m.index! + m[0].length, 'Capitalization', '“you” is not capitalized here.', [
      { kind: 'replace', text: 'Thank you' },
    ]),
  );

/* ------------------------------------------------------------------------------------ */
/* "I have send" → "I have sent", "has been create" → "has been created"                 */
/* ------------------------------------------------------------------------------------ */
const IRREGULAR: Record<string, string> = {
  send: 'sent', take: 'taken', give: 'given', write: 'written', go: 'gone', see: 'seen', find: 'found',
  make: 'made', tell: 'told', begin: 'begun', break: 'broken', bring: 'brought', buy: 'bought', catch: 'caught',
  choose: 'chosen', eat: 'eaten', feel: 'felt', forget: 'forgotten', hear: 'heard', keep: 'kept', know: 'known',
  lose: 'lost', meet: 'met', speak: 'spoken', spend: 'spent', steal: 'stolen', teach: 'taught', think: 'thought',
  throw: 'thrown', understand: 'understood', wear: 'worn', win: 'won', grow: 'grown', draw: 'drawn', fly: 'flown',
  forgive: 'forgiven', ride: 'ridden', sell: 'sold', shake: 'shaken', freeze: 'frozen', mistake: 'mistaken',
  overwrite: 'overwritten', rewrite: 'rewritten', undo: 'undone',
};
// Regular verbs that are rarely nouns (so "have add" is a mistake, not "have an add").
const REGULAR = [
  'add', 'ask', 'attach', 'inform', 'notify', 'modify', 'verify', 'mention', 'remove', 'reply', 'observe', 'discuss',
  'explain', 'implement', 'provide', 'resolve', 'finish', 'try', 'receive', 'raise', 'merge', 'create', 'confirm',
  'connect', 'contact', 'install', 'configure', 'analyze', 'analyse', 'investigate', 'identify', 'enable', 'disable',
  'follow', 'upload', 'download', 'approve', 'assign', 'escalate', 'migrate', 'refactor', 'rename', 'restart', 'retry',
  'revert', 'submit', 'visit', 'join', 'reproduce', 'debug', 'deploy', 'mark', 'move', 'apply', 'decide', 'delete',
  'insert', 'introduce', 'mention', 'complete', 'prepare', 'publish', 'achieve', 'commit', 'plan', 'stop', 'drop',
  'occur', 'reach', 'solve', 'start', 'happen', 'notice', 'face', 'convert', 'collect', 'clean', 'close', 'open',
  'share', 'suggest', 'test', 'use', 'verify', 'work', 'push', 'pull', 'block', 'unblock', 'trigger', 'handle',
  'require', 'store', 'save', 'cause', 'consume', 'process', 'display', 'schedule', 'update', 'configure',
];
const PARTICIPLE: Record<string, string> = { ...Object.fromEntries(REGULAR.map((v) => [v, regularParticiple(v)])), ...IRREGULAR };
// Verbs that are also common nouns after "have": only fix them after "been" ("has been test" → tested).
const NOUNISH = new Set(['test', 'use', 'work', 'start', 'push', 'pull', 'block', 'face', 'notice', 'open', 'close', 'mark', 'share', 'drop', 'plan', 'stop', 'move', 'complete', 'clean', 'store', 'cause', 'process', 'display', 'schedule', 'update', 'require', 'save']);
// After is/are/was/were/be/get: base forms that are clearly a missing "-ed" ("is require" → "is required").
// (Not words that also work as adjectives: "is complete", "is open", "is clean".)
const PASSIVE_OK = new Set([
  'require', 'send', 'create', 'add', 'assign', 'attach', 'inform', 'notify', 'modify', 'verify', 'mention', 'remove',
  'deploy', 'merge', 'raise', 'resolve', 'implement', 'provide', 'schedule', 'store', 'save', 'delete', 'insert',
  'trigger', 'handle', 'use', 'cause', 'configure', 'consume', 'process', 'display', 'write', 'give', 'take', 'make',
  'see', 'update', 'install', 'enable', 'disable', 'approve', 'migrate', 'upload', 'download', 'receive', 'publish',
]);
const VERB_ALT = Object.keys(PARTICIPLE).sort((a, b) => b.length - a.length).join('|');
const HAVE_RE = new RegExp(
  `\\b(have|has|had|haven't|hasn't|hadn't|I've|we've|you've|they've|been|is|are|was|were|be|being|isn't|aren't|wasn't|weren't|get|gets|got)\\s+(?:(?:also|already|just|not|never|recently|now|still|successfully|automatically|currently)\\s+)?(${VERB_ALT})\\b(?!['’-])`,
  'gi',
);

const haveParticiple: Rule = ({ text }) => {
  const out: Issue[] = [];
  for (const m of text.matchAll(HAVE_RE)) {
    const aux = m[1].toLowerCase();
    const verb = m[2];
    const lower = verb.toLowerCase();
    const isPassive = /^(?:is|are|was|were|be|being|isn't|aren't|wasn't|weren't|get|gets|got)$/.test(aux);
    if (isPassive && !PASSIVE_OK.has(lower)) continue;
    if (!isPassive && aux !== 'been' && NOUNISH.has(lower)) continue;
    // "have to go", "had come to"… the infinitive sense is fine.
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 4);
    if (/^\s+to\b/i.test(after) && aux !== 'been') continue;
    // "be use to" / "get send to" are rare; "is use" before a noun can be "is (of) use" — skip "is use of".
    if (isPassive && /^\s+of\b/i.test(after)) continue;
    const fix = PARTICIPLE[lower];
    if (!fix || fix === lower) continue;
    const start = m.index! + m[0].length - verb.length;
    out.push(
      issue('have-participle', text, start, start + verb.length, 'Grammar', `After “${m[1]}”, use “${fix}”.`, [
        { kind: 'replace', text: verb[0] === verb[0].toUpperCase() ? capitalize(fix) : fix },
      ]),
    );
  }
  return out;
};

/* ------------------------------------------------------------------------------------ */
/* Plural after numbers and quantity words: "2 month" → "2 months", "some alert are"     */
/* ------------------------------------------------------------------------------------ */
const COUNT_NOUNS = [
  'month', 'week', 'day', 'hour', 'minute', 'second', 'year', 'time', 'issue', 'error', 'alert', 'record', 'ticket',
  'user', 'driver', 'request', 'file', 'job', 'pod', 'book', 'query', 'document', 'change', 'item', 'step', 'point',
  'link', 'page', 'flag', 'message', 'route', 'story', 'chore', 'bug', 'log', 'customer', 'client', 'member', 'feature',
  'release', 'environment', 'server', 'service', 'field', 'event', 'meeting', 'call', 'email', 'mail', 'test', 'case',
  'option', 'question', 'comment', 'commit', 'branch', 'repo', 'table', 'collection', 'database', 'account', 'role',
  'team', 'person', 'leave', 'holiday', 'appointment', 'doctor', 'finger', 'meme', 'video', 'image', 'screenshot',
  'condition', 'notification', 'instance', 'node', 'cluster', 'namespace', 'deployment', 'container', 'replica',
  'sprint', 'task', 'subtask', 'version', 'build', 'run', 'attempt', 'retry', 'restart', 'spike', 'report', 'dashboard',
];
const NUMBER_WORD = '(?:[2-9]|[1-9]\\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|multiple|many|various|few|both|these|those)';
const NOUN_ALT = COUNT_NOUNS.join('|');
const AFTER_NUMBER = new RegExp(`\\b${NUMBER_WORD}\\s+(?:new\\s+|more\\s+|old\\s+|other\\s+)?(${NOUN_ALT})(['’]s)?(?![\\p{L}\\p{N}'’-])`, 'giu');
const SOME_ARE = new RegExp(`\\b(?:some|all)\\s+(${NOUN_ALT})(?=\\s+(?:are|were|have|need|seem|look|exist)\\b)`, 'gi');

const pluralAfterQuantity: Rule = ({ text }) => {
  const out: Issue[] = [];
  const add = (start: number, noun: string, possessive = '') => {
    const fix = plural(noun);
    out.push(
      issue('plural', text, start, start + noun.length + possessive.length, 'Agreement', `Use the plural “${fix}” here.`, [
        { kind: 'replace', text: fix },
      ]),
    );
  };
  // Only when the next word can't be part of the same noun phrase ("2 route numbers" stays).
  const nextOk = (end: number) => {
    const next = /^\s*([\p{L}]+|[^\s\p{L}]|$)/u.exec(text.slice(end))?.[1] ?? '';
    return next === '' || !/\p{L}/u.test(next) || AFTER_PLURAL.has(next.toLowerCase());
  };
  for (const m of text.matchAll(AFTER_NUMBER)) {
    if (nextOk(m.index! + m[0].length)) add(m.index! + m[0].length - m[1].length - (m[2]?.length ?? 0), m[1], m[2] ?? '');
  }
  for (const m of text.matchAll(SOME_ARE)) add(m.index! + m[0].length - m[1].length, m[1]);
  return out;
};

/* ------------------------------------------------------------------------------------ */
/* Missing article: "in runbook" → "in the runbook", "book appointment" → "book an …"     */
/* ------------------------------------------------------------------------------------ */
// Common singular countable nouns in everyday and work messages (not plurals or mass nouns).
const ARTICLE_NOUNS = [
  'office', 'hospital', 'doctor', 'clinic', 'team', 'document', 'page', 'ticket', 'database', 'server', 'meeting',
  'group', 'channel', 'portal', 'form', 'link', 'file', 'folder', 'repo', 'repository', 'branch', 'release', 'sprint',
  'appointment', 'issue', 'request', 'response', 'query', 'collection', 'job', 'scheduler', 'alert', 'condition',
  'solution', 'dashboard', 'pipeline', 'service', 'app', 'application', 'codebase', 'backend', 'frontend', 'config',
  'configuration', 'environment', 'cluster', 'pod', 'report', 'project', 'task', 'story', 'chore', 'bug', 'feature',
  'product', 'client', 'customer', 'user', 'manager', 'system', 'process', 'script', 'function', 'module', 'package',
  'library', 'tool', 'platform', 'website', 'site', 'browser', 'laptop', 'machine', 'screen', 'button', 'field',
  'column', 'table', 'list', 'record', 'event', 'topic', 'queue', 'consumer', 'payload', 'endpoint', 'gateway',
  'account', 'runbook', 'playbook', 'wiki', 'thread', 'demo', 'build', 'deployment', 'migration', 'upgrade', 'version',
  'approach', 'analysis', 'investigation', 'discussion', 'weekend', 'morning', 'evening', 'afternoon', 'driver',
  'route', 'device', 'operation', 'surgery', 'insurance', 'apartment', 'kitchen', 'door', 'bus', 'train', 'flight',
  'calendar', 'call', 'question', 'problem',
];
// Nouns that are also verbs: after "to" they're usually infinitives ("need to change", "decide to page").
const VERBISH = new Set([
  'page', 'form', 'link', 'file', 'release', 'issue', 'request', 'response', 'query', 'job', 'alert', 'condition',
  'report', 'task', 'feature', 'process', 'list', 'record', 'event', 'build', 'demo', 'upgrade', 'approach', 'call',
  'question', 'problem', 'table', 'field', 'route', 'script', 'function', 'package', 'tool', 'screen', 'queue', 'table',
  'thread', 'version', 'operation', 'account', 'user', 'driver', 'service', 'module', 'record', 'column', 'button',
]);
// Fixed phrases that don't take an article.
const NO_ARTICLE = /^(?:at (?:home|work|night|noon|least|once|all)|in (?:time|person|production|prod|progress|general|total|detail|advance|future|case|charge)|on (?:time|call|hold|track|leave|email|mail|whatsapp|teams|slack|phone)|by (?:email|mail|phone|default|design|hand)|to (?:work|home|bed|school|college|lunch|dinner|date))$/i;
const DETERMINER = /^(?:the|a|an|this|that|these|those|my|our|your|his|her|their|its|each|every|any|some|no|one|which|what|another)$/i;
const PREPOSITION_RE = new RegExp(`\\b(in|to|on|at|from|with|into|inside|within|onto)\\s+(${ARTICLE_NOUNS.join('|')})\\b(?![-'’])`, 'gi');
const VERB_NOUN_RE = new RegExp(
  `\\b(book|booked|booking|take|took|taking|raise|raised|raising|create|created|creating|open|opened|schedule|scheduled|have|had|need|needs|needed|write|wrote|make|made|set up|send|sent|add|added)\\s+(${ARTICLE_NOUNS.join('|')})\\b(?![-'’])`,
  'gi',
);

const article: Rule = ({ text }) => {
  const out: Issue[] = [];
  const consider = (m: RegExpMatchArray, art: (noun: string) => string) => {
    const noun = m[2];
    const nounStart = m.index! + m[0].length - noun.length;
    const after = text.slice(nounStart + noun.length, nounStart + noun.length + 30);
    // Skip plurals/possessives, "X of …", and nouns followed by an ID, code, link or label colon
    // ("in ticket ME-484259", "For alert: https://…") — those are names, not plain nouns.
    if (/^\s*(?:s\b|['’]s|\(|of\b|:|`|https?:|[A-Z]{2,}|[\w-]*\d)/.test(after)) return;
    if (m[1].toLowerCase() === 'to' && VERBISH.has(noun.toLowerCase())) return;
    if (NO_ARTICLE.test(`${m[1]} ${noun}`.toLowerCase())) return;
    if (/^\p{Lu}/u.test(noun)) return; // "in Portal" may be a product name
    const a = art(noun);
    out.push(
      issue('article', text, nounStart, nounStart + noun.length, 'Grammar', `A word may be missing here: “${m[1]} ${a} ${noun}”.`, [
        { kind: 'replace', text: `${a} ${noun}` },
      ]),
    );
  };
  for (const m of text.matchAll(PREPOSITION_RE)) consider(m, () => 'the');
  for (const m of text.matchAll(VERB_NOUN_RE)) consider(m, (n) => (/^[aeiou]/i.test(n) ? 'an' : 'a'));
  // Already preceded by a determiner? (regex can't look behind far enough for multi-word cases)
  return out.filter((i) => {
    const before = text.slice(Math.max(0, i.start - 20), i.start).trim().split(/\s+/);
    return !DETERMINER.test(before[before.length - 1] ?? '');
  });
};

/* ------------------------------------------------------------------------------------ */
/* ", We have…" → ". We have…": a capitalised word after a comma starts a new sentence   */
/* ------------------------------------------------------------------------------------ */
const NEW_SENTENCE_WORDS =
  'We|Just|After|Currently|Also|Please|Could|Can|This|That|There|It|They|He|She|So|But|Then|However|Below|Here|Now|Once|When|As|Our|My|Your|These|Those|Today|Tomorrow|Yesterday|Let|Kindly|Moreover|Additionally|Meanwhile|Otherwise|Hence|Therefore|Thanks|Thank';
const COMMA_CAPITAL = new RegExp(`,\\s+(${NEW_SENTENCE_WORDS})\\b`, 'g');
const GREETING_START = /^(?:hi|hello|hey|dear|thanks|thank you|yes|no|ok|okay|sure|also|so|but|however|well|now|then)\b/i;

const commaCapital: Rule = ({ text }) => {
  const out: Issue[] = [];
  for (const m of text.matchAll(COMMA_CAPITAL)) {
    const at = m.index!;
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    const before = text.slice(lineStart, at);
    const clause = before.split(/[.!?]\s+/).pop() ?? before;
    const words = clause.match(WORD_RE) ?? [];
    if (words.length < 4 || GREETING_START.test(clause.trim())) continue;
    const end = at + m[0].length;
    out.push(
      issue('comma-capital', text, at, end, 'Punctuation', `“${m[1]}” starts a new sentence — use a full stop before it.`, [
        { kind: 'replace', text: `. ${m[1]}` },
      ]),
    );
  }
  return out;
};

/* ------------------------------------------------------------------------------------ */
/* "Yesterday I have changed…" → "Yesterday I changed…" (finished past time)             */
/* ------------------------------------------------------------------------------------ */
const PAST_TIME = /\b(?:yesterday|last (?:week|sprint|month|year|time|night|release|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d+ (?:days?|weeks?|months?|years?|hours?|minutes?) ago|ago|earlier today|this morning)\b/i;
const PERFECT = /\b(I|we|he|she|they|you)\s+(have|has)\s+(?=(?:also\s+|already\s+)?(?:[a-z]+ed|sent|taken|made|found|done|seen|got|given|written|told|bought|brought|met|faced|changed|tried)\b)/gi;

const pastTimePerfect: Rule = ({ text }) => {
  const out: Issue[] = [];
  for (const line of lines(text)) {
    // Same clause only: "Last sprint we have added…, I have informed…" — only the first is past.
    let from = 0;
    for (const clause of line.text.split(/(?<=[.!?,;])\s+/)) {
      const offset = line.start + line.text.indexOf(clause, from);
      from = offset - line.start + clause.length;
      if (!PAST_TIME.test(clause)) continue;
      for (const m of clause.matchAll(PERFECT)) {
        const start = offset + m.index! + m[1].length + 1;
        const end = start + m[2].length + (m[0].length - m[1].length - 1 - m[2].length);
        out.push(
          issue('past-time', text, start, end, 'Grammar', 'With a finished time like “yesterday” or “last sprint”, use the simple past (remove “have”).', [
            { kind: 'replace', text: '' },
          ]),
        );
      }
    }
  }
  return out;
};

/* ------------------------------------------------------------------------------------ */
/* "Please Update the…" → "Please update the…"                                           */
/* ------------------------------------------------------------------------------------ */
const PLEASE_VERB =
  /\b([Pp]lease)\s+(Update|Check|Review|Let|Confirm|Add|Help|Share|Find|Send|Approve|Merge|Look|Take|Ignore|Note|Use|Make|Do|Go|Provide|Verify|Remove|Create|Fix|Reply|Join|Call|Contact|Find|Have|Keep|Ask|Feel)\b/g;

const pleaseLowercase: Rule = ({ text }) =>
  [...text.matchAll(PLEASE_VERB)].map((m) => {
    const start = m.index! + m[0].length - m[2].length;
    return issue('please-lowercase', text, start, start + m[2].length, 'Capitalization', `No capital letter needed after “please”.`, [
      { kind: 'replace', text: m[2].toLowerCase() },
    ]);
  });

/* ------------------------------------------------------------------------------------ */
/* Names from the dictionary typed in lower case: "rahul" → "Rahul"                       */
/* ------------------------------------------------------------------------------------ */
const nameCapital: Rule = ({ text, ctx }) => {
  if (!ctx.names.size) return [];
  const out: Issue[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_./@-])([\p{Ll}][\p{Ll}'’]+)(?![\p{L}\p{N}_/@-]|\.[\p{L}])/gu)) {
    const word = m[1];
    const base = word.replace(/['’]s$/, '');
    if (!ctx.names.has(base)) continue;
    const fixed = (ctx.canonical.get(base) ?? capitalize(base)) + word.slice(base.length);
    out.push(
      issue('name-capital', text, m.index!, m.index! + word.length, 'Capitalization', `Names start with a capital letter: “${fixed}”.`, [
        { kind: 'replace', text: fixed },
      ]),
    );
  }
  return out;
};

/* ------------------------------------------------------------------------------------ */
/* "it work for me" → "it works for me" (he/she/it + verb)                                */
/* ------------------------------------------------------------------------------------ */
const THIRD_PERSON: Record<string, string> = {
  have: 'has', do: 'does', go: 'goes', work: 'works', look: 'looks', seem: 'seems', need: 'needs', want: 'wants',
  happen: 'happens', cause: 'causes', fail: 'fails', run: 'runs', show: 'shows', take: 'takes', make: 'makes',
  mean: 'means', depend: 'depends', exist: 'exists', contain: 'contains', support: 'supports', allow: 'allows',
  require: 'requires', return: 'returns', throw: 'throws', create: 'creates', send: 'sends', get: 'gets',
  give: 'gives', keep: 'keeps', stay: 'stays', come: 'comes', cover: 'covers', help: 'helps', match: 'matches',
  reach: 'reaches', belong: 'belongs', know: 'knows', think: 'thinks', say: 'says', like: 'likes', feel: 'feels',
};
const THIRD_RE = new RegExp(`(?<![\\p{L}'’])(it|he|she)\\s+(${Object.keys(THIRD_PERSON).join('|')})\\b(?![-'’])`, 'giu');
// "make it work", "let it go", "will it work", "does it look", "see him do", "how it work" (still wrong, but rare).
const NOT_AFTER = /\b(?:make|makes|made|making|let|lets|help|helps|helped|see|saw|watch|hear|heard|will|would|can|could|should|shall|may|might|must|does|did|do|to|have|had|has|get|got|want|wanted|need|needed|why|whether|if)\s*$/i;

const thirdPerson: Rule = ({ text }) => {
  const out: Issue[] = [];
  for (const m of text.matchAll(THIRD_RE)) {
    const before = text.slice(Math.max(0, m.index! - 15), m.index!);
    if (NOT_AFTER.test(before)) continue;
    const verb = m[2];
    const fix = THIRD_PERSON[verb.toLowerCase()];
    const start = m.index! + m[0].length - verb.length;
    out.push(
      issue('third-person', text, start, start + verb.length, 'Agreement', `After “${m[1]}”, use “${fix}”.`, [{ kind: 'replace', text: fix }]),
    );
  }
  return out;
};

export const RULES: Record<string, Rule> = {
  'third-person': thirdPerson,
  'name-capital': nameCapital,
  'comma-capital': commaCapital,
  'past-time': pastTimePerfect,
  'please-lowercase': pleaseLowercase,
  article,
  greeting,
  'end-punctuation': endPunctuation,
  'line-start-capital': lineStartCapital,
  'thank-you': thankYou,
  'have-participle': haveParticiple,
  plural: pluralAfterQuantity,
};

export function runRules(input: RuleInput, enabled: string[] = Object.keys(RULES)): Issue[] {
  return enabled.flatMap((name) => RULES[name]?.(input) ?? []);
}
