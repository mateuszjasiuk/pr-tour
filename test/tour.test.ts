import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTour, fromCodeTour } from '../src/tour.ts';

const codeTour = {
  $schema: 'https://aka.ms/codetour-schema',
  title: 'Billing changes',
  ref: '3f2a9c1',
  steps: [
    { file: 'src/billing/invoice.ts', line: 42, title: 'Start here', description: 'We now prorate by **day**.\n\nSecond paragraph.' },
    { file: './src/foo.ts', selection: { start: { line: 88, character: 1 }, end: { line: 95, character: 4 } }, description: 'A range' },
    { title: 'Wrap-up', description: 'No file, just a note' },
  ],
};

const body = (fence: string, lang: string, json = JSON.stringify(codeTour, null, 2)) => `Fixes the proration bug.

🧭 [Take the review tour](https://x/o/r/pull/1)

<details><summary>Review tour</summary>

${fence}${lang}
${json}
${fence}

</details>`;

test('maps CodeTour steps: line, selection range, file-less note', () => {
  const t = extractTour(body('```', 'json'))!;

  assert.equal(t.title, 'Billing changes');
  assert.equal(t.head, '3f2a9c1');
  assert.deepEqual(t.steps, [
    { file: 'src/billing/invoice.ts', line: 42, endLine: undefined, title: 'Start here', body: 'We now prorate by **day**.\n\nSecond paragraph.' },
    { file: 'src/foo.ts', line: 88, endLine: 95, title: '', body: 'A range' },
    { file: undefined, line: undefined, endLine: undefined, title: 'Wrap-up', body: 'No file, just a note' },
  ]);
});

test('finds the tour whatever the fence looks like', () => {
  const indented = JSON.stringify(codeTour, null, 2).split('\n').map((l) => `  ${l}`).join('\n');
  for (const b of [
    body('```', 'json'),
    body('```', 'codetour'),
    body('```', ''),
    body('~~~', 'jsonc'),
    body('````', 'json'),
    body('```', 'json', JSON.stringify(codeTour)),
    body('  ```', 'json', indented).replace(/\n  ```\n\n<\/details>/, '\n  ```  \n\n</details>'),
    body('```', 'json').replace(/\n/g, '\r\n'),
  ]) {
    assert.equal(extractTour(b)?.steps.length, 3, b);
  }
});

test('skips other JSON blocks and takes the first tour', () => {
  const md = '```json\n{"not": "a tour"}\n```\n\n```json\nnot json at all\n```\n\n' + body('```', 'json');
  assert.equal(extractTour(md)?.title, 'Billing changes');
});

test('no tour → null', () => {
  assert.equal(extractTour('just text'), null);
  assert.equal(extractTour('```json\n{"steps": "nope"}\n```'), null);
  assert.equal(extractTour(null), null);
});

test('a branch name in ref is not a commit, so no head', () => {
  assert.equal(fromCodeTour({ ref: 'main', steps: [] })?.head, undefined);
});
