import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTour, formatTour, upsertSnippet } from '../src/tour.ts';

const body = `Fixes the proration bug.

🧭 [Take the review tour](https://x/o/r/pull/1)

<details><summary>Review tour</summary>

\`\`\`tour head=3f2a9c1
1. src/billing/invoice.ts:42 — Start here: new proration logic
   We now prorate by **day**, see \`daysIn\`.

   Second paragraph.
2. src/billing/invoice.ts:88-95 - Edge case: see foo:12
3. a/src/legacy.ts:-17
\`\`\`

</details>`;

test('extracts steps from a collapsed block', () => {
  const t = extractTour(body)!;
  assert.equal(t.head, '3f2a9c1');
  assert.equal(t.steps.length, 3);
  assert.deepEqual(t.steps[0], {
    file: 'src/billing/invoice.ts', line: 42, endLine: undefined, side: 'new',
    title: 'Start here: new proration logic',
    body: 'We now prorate by **day**, see `daysIn`.\n\nSecond paragraph.',
  });
  assert.equal(t.steps[1].endLine, 95);
  assert.equal(t.steps[1].title, 'Edge case: see foo:12');
  assert.deepEqual([t.steps[2].file, t.steps[2].side, t.steps[2].line, t.steps[2].title], ['src/legacy.ts', 'old', 17, '']);
});

test('no block → null', () => {
  assert.equal(extractTour('just text'), null);
  assert.equal(extractTour(null), null);
});

test('format round-trips', () => {
  const t = extractTour(body)!;
  assert.deepEqual(extractTour(formatTour(t)), t);
});

test('upsert replaces an existing snippet and appends otherwise', () => {
  const t = { head: 'abcdef0', steps: [{ file: 'a.ts', line: 1, side: 'new' as const, title: 'hi', body: '' }] };
  const replaced = upsertSnippet(body, 'https://x/o/r/pull/1', t);
  assert.ok(replaced.startsWith('Fixes the proration bug.'));
  assert.equal(extractTour(replaced)!.steps.length, 1);
  assert.equal((replaced.match(/Review tour<\/summary>/g) ?? []).length, 1);
  const appended = upsertSnippet('Plain body', 'https://x/o/r/pull/1', t);
  assert.equal(extractTour(appended)!.steps[0].title, 'hi');
});
