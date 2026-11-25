/**
 * Parses the personal test data (test-data/*.json). Pure functions so they also run in
 * the browser test page. Each case is an original message and the AI-corrected version.
 */

export interface Case {
  id: string;
  input: string;
  reference: string;
  /** True when the request was only "correct spelling and grammar" (no rewrite/format/translate). */
  pure: boolean;
}

const EXTRA_REQUEST =
  /translat|spanish|short|polite|format|markdown|relative path|table|rewrite|professional|summar|bullet|look like|make it|change all|convert|slack|jira|confluence|teams message|email/i;

function cleanReply(reply: string): string {
  let text = reply.replace(/\r/g, '');
  // "Here's the corrected version:\n---\n<text>\n---\n<explanations>"
  const parts = text.split(/^\s*-{3,}\s*$/m);
  if (parts.length >= 3) text = parts[1];
  else {
    text = text.replace(/^\s*(?:here(?:'|’)?s|here is|below is|sure|corrected)[^\n]*:\s*\n/i, '');
  }
  // Drop explanation sections and sign-offs the assistant appended.
  text = text.split(
    /^\s*(?:#+\s*)?(?:\*\*)?(?:changes|key changes|summary of changes|corrections|main changes|what (?:i )?changed|notes?|explanation)\b[^\n]*$/im,
  )[0];
  text = text.replace(/\n\s*(?:let me know|i hope|feel free)[^\n]*$/i, '');
  return text.trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseCorrections(data: any): Case[] {
  if (!data?.entries) return [];
  const out: Case[] = [];
  for (const e of data.entries) {
    let ref: string | null = e.output;
    // The note sometimes says the reply was wrong and gives the right version.
    const fixed = /correct version is:\s*"([^"]+)"/i.exec(e.note ?? '');
    if (fixed) ref = fixed[1];
    if (!ref || e.output_complete === false || /translat/i.test(e.instruction)) continue;
    const rest = e.instruction.replace(/^.*?(spelling|grammar|grammer)[^,.]*?(below|following)?/i, '');
    out.push({ id: `c${e.id}`, input: e.input, reference: ref, pure: !EXTRA_REQUEST.test(rest) });
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePrompts(data: any): Case[] {
  if (!data?.entries) return [];
  const out: Case[] = [];
  for (const e of data.entries) {
    if (!e.prompt || !e.output) continue;
    const lines = String(e.prompt).replace(/\r/g, '').split('\n');
    const instruction = lines[0];
    const input = lines.slice(1).join('\n').trim();
    const reference = cleanReply(e.output);
    if (!input || !reference) continue;
    const ratio = reference.length / input.length;
    const rest = instruction.replace(/^.*?(spelling|grammar|grammer)( mistakes?)?( of)?( below| following)?/i, '');
    out.push({
      id: `p${e.id}`,
      input,
      reference,
      pure: !EXTRA_REQUEST.test(rest) && ratio > 0.7 && ratio < 1.5,
    });
  }
  return out;
}

