// Tour format: a ```tour fenced block, usually inside a collapsed <details> in the PR description.
//
//   ```tour head=3f2a9c1
//   1. src/billing/invoice.ts:42 — Start here: new proration logic
//      Optional body lines, indented under the step.
//   2. src/billing/invoice.ts:88-95 — A range of lines
//   3. src/legacy.ts:-17 — A leading minus points at the OLD (deleted) side
//   ```

export type Side = 'new' | 'old';

export interface Step {
  file: string;
  line: number;
  endLine?: number;
  side: Side;
  title: string;
  body: string;
}

export interface Tour {
  head?: string; // commit the tour was written against, to warn when the PR has moved on
  steps: Step[];
}

const FENCE = /^```tour([^\n]*)\n([\s\S]*?)^```/m;
const STEP = /^\s*\d+[.)]\s+(.+?):(-)?(\d+)(?:-(\d+))?\s*(?:[—–-]+\s*(.*))?$/;

export function extractTour(markdown: string | null | undefined): Tour | null {
  if (!markdown) return null;
  const m = markdown.replace(/\r\n/g, '\n').match(FENCE);
  if (!m) return null;
  const head = m[1].match(/\bhead=([0-9a-f]{7,40})\b/i)?.[1];
  return { head, steps: parseSteps(m[2]) };
}

export function parseSteps(src: string): Step[] {
  const steps: Step[] = [];
  let bodyLines: string[] = [];

  const flush = () => {
    const cur = steps[steps.length - 1];
    if (cur) cur.body = dedent(bodyLines).trim();
    bodyLines = [];
  };

  for (const raw of src.split('\n')) {
    const m = raw.match(STEP);
    if (m) {
      flush();
      const [, file, minus, line, end, title] = m;
      steps.push({
        file: file.trim().replace(/^[ab]\//, ''),
        line: Number(line),
        endLine: end ? Number(end) : undefined,
        side: minus ? 'old' : 'new',
        title: (title ?? '').trim(),
        body: '',
      });
    } else if (steps.length) {
      bodyLines.push(raw);
    }
  }
  flush();
  return steps;
}

function dedent(lines: string[]): string {
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

export function formatTour(tour: Tour): string {
  const lines = [tour.head ? `\`\`\`tour head=${tour.head}` : '```tour'];
  tour.steps.forEach((s, i) => {
    const loc = `${s.file}:${s.side === 'old' ? '-' : ''}${s.line}${s.endLine ? `-${s.endLine}` : ''}`;
    lines.push(`${i + 1}. ${loc}${s.title ? ` — ${s.title}` : ''}`);
    if (s.body) for (const b of s.body.split('\n')) lines.push(b ? `   ${b}` : '');
  });
  lines.push('```');
  return lines.join('\n');
}

/** The snippet to paste into a PR description. */
export function prSnippet(tourUrl: string, tour: Tour): string {
  return [
    `🧭 [Take the review tour](${tourUrl})`,
    '',
    '<details><summary>Review tour</summary>',
    '',
    formatTour(tour),
    '',
    '</details>',
  ].join('\n');
}

/** Replace the tour block in a PR body (or append the snippet if there is none). */
export function upsertSnippet(body: string, tourUrl: string, tour: Tour): string {
  const snippet = prSnippet(tourUrl, tour);
  const existing = /🧭 \[Take the review tour\]\([^)]*\)\s*<details><summary>Review tour<\/summary>[\s\S]*?<\/details>/;
  if (existing.test(body)) return body.replace(existing, snippet);
  return `${body.trimEnd()}\n\n${snippet}\n`;
}
