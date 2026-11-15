import type { DiffFile } from 'diff2html/lib/types';
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Dynamic imports, so Vite splits each grammar into its own file and only the languages in the
// PR are downloaded.
const LANGS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  go: () => import('shiki/langs/go.mjs'),
};

const BY_EXT: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  css: 'css', json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', sql: 'sql', go: 'go',
};

/**
 * Colours the code in the rendered diff, one file at a time. Each hunk is tokenized as two blocks
 * (old side and new side), so comments and strings that span lines are coloured correctly.
 */
export async function highlightDiff(root: HTMLElement, files: DiffFile[]): Promise<void> {
  const wrappers = root.querySelectorAll<HTMLElement>('.d2h-file-wrapper');

  for (const [i, wrapper] of wrappers.entries()) {
    const name = files[i]?.newName === '/dev/null' ? files[i].oldName : files[i]?.newName;
    const lang = langFor(name);
    if (!lang) continue;

    const h = await highlighterFor(lang);
    for (const hunk of hunks(wrapper)) colourHunk(h, lang, hunk);
    // Let the browser paint and handle scrolling between files.
    await new Promise((r) => setTimeout(r));
  }
}

/** Colours consecutive lines of one file, given their `.d2h-code-line-ctn` elements in order. */
export async function highlightLines(ctns: HTMLElement[], fileName: string): Promise<void> {
  const lang = langFor(fileName);
  if (!lang) return;

  const h = await highlighterFor(lang);
  const rows: Row[] = ctns.map((ctn) => ({ ctn, side: 'new' }));
  tokenize(h, lang, rows).forEach((tokens, i) => paint(ctns[i], tokens));
}

let highlighter: Promise<HighlighterCore> | undefined;

async function highlighterFor(lang: string): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  const h = await highlighter;
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(LANGS[lang]() as never);
  return h;
}

function langFor(fileName: string | undefined): string | undefined {
  return BY_EXT[fileName?.split('.').pop()?.toLowerCase() ?? ''];
}

interface Row { ctn: HTMLElement; side: 'old' | 'new' | 'both' }

/** Groups a file's code rows into hunks; the `@@` rows (d2h-info) separate them. */
function hunks(wrapper: HTMLElement): Row[][] {
  const out: Row[][] = [];
  let cur: Row[] = [];

  for (const tr of wrapper.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
    if (tr.classList.contains('tour-note')) continue;
    const code = tr.cells[1];
    if (!code || code.classList.contains('d2h-info')) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    const ctn = code.querySelector<HTMLElement>('.d2h-code-line-ctn');
    if (!ctn) continue;
    const side = code.classList.contains('d2h-del') ? 'old' : code.classList.contains('d2h-ins') ? 'new' : 'both';
    cur.push({ ctn, side });
  }
  if (cur.length) out.push(cur);
  return out;
}

function colourHunk(h: HighlighterCore, lang: string, rows: Row[]) {
  const oldRows = rows.filter((r) => r.side !== 'new');
  const newRows = rows.filter((r) => r.side !== 'old');
  const oldTokens = tokenize(h, lang, oldRows);
  const newTokens = tokenize(h, lang, newRows);

  oldRows.forEach((r, i) => r.side === 'old' && paint(r.ctn, oldTokens[i]));
  newRows.forEach((r, i) => paint(r.ctn, newTokens[i]));
}

function tokenize(h: HighlighterCore, lang: string, rows: Row[]): ThemedToken[][] {
  const code = rows.map((r) => r.ctn.textContent ?? '').join('\n');
  return h.codeToTokens(code, { lang, themes: { light: 'github-light', dark: 'github-dark' } }).tokens;
}

/**
 * Wraps the line's text in coloured spans. It splits the existing text nodes instead of replacing
 * the HTML, so diff2html's word-level <ins>/<del> marks stay.
 */
function paint(ctn: HTMLElement, tokens: ThemedToken[] | undefined) {
  if (!tokens || tokens.map((t) => t.content).join('') !== ctn.textContent) return;

  const ranges: { end: number; style: string }[] = [];
  let pos = 0;
  for (const t of tokens) {
    pos += t.content.length;
    const style = Object.entries(t.htmlStyle ?? {}).map(([k, v]) => `${k}:${v}`).join(';');
    ranges.push({ end: pos, style });
  }

  let offset = 0;
  let r = 0;
  for (const text of textNodes(ctn)) {
    const value = text.data;
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < value.length) {
      while (ranges[r].end <= offset + i) r++;
      const take = Math.min(value.length - i, ranges[r].end - (offset + i));
      const span = document.createElement('span');
      span.setAttribute('style', ranges[r].style);
      span.textContent = value.slice(i, i + take);
      frag.append(span);
      i += take;
    }
    offset += value.length;
    text.replaceWith(frag);
  }
}

function textNodes(node: Node): Text[] {
  if (node.nodeType === Node.TEXT_NODE) return [node as Text];
  return [...node.childNodes].flatMap(textNodes);
}
