import { parse, html } from 'diff2html';
import type { DiffFile } from 'diff2html/lib/types';
import 'diff2html/bundles/css/diff2html.min.css';
import LZString from 'lz-string';
import './style.css';
import { extractTour, fromCodeTour, type Step, type Tour } from './tour.ts';
import { AuthError, getPull, getPullDiff, type Pull } from './github.ts';

// ---------- small utils ----------
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get: (k: string, s: Storage = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k: string, v: string, s: Storage = localStorage) => { try { s.setItem(k, v); } catch {} },
  del: (k: string, s: Storage = localStorage) => { try { s.removeItem(k); } catch {} },
};

/** Just enough Markdown for step notes: paragraphs, `code`, **bold**, _em_, [links](https://…). */
function md(src: string): string {
  return src.split(/\n\s*\n/).map((p) => `<p>${esc(p)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>')}</p>`).join('');
}

// ---------- auth (token lives only in this browser) ----------
const TOKEN = 'prtour.token';
(function absorbTokenFromRedirect() {
  const m = location.hash.match(/access_token=([^&]+)/);
  if (!m) return;
  store.set(TOKEN, decodeURIComponent(m[1]));
  const savedHash = store.get('prtour.hash', sessionStorage) ?? '';
  store.del('prtour.hash', sessionStorage);
  history.replaceState(null, '', location.pathname + location.search + savedHash);
})();
const token = () => store.get(TOKEN);
function signIn() {
  store.set('prtour.hash', location.hash, sessionStorage);
  location.href = `/api/login?return=${encodeURIComponent(location.pathname + location.search)}`;
}
function signOut() { store.del(TOKEN); location.reload(); }

// ---------- state ----------
const app = $('#app');
const route = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
let pull: Pull;
let files: DiffFile[] = [];
let tour: Tour = { steps: [] };
let current = 0;

if (route) load(route[1], route[2], Number(route[3]));
else landing();

// ---------- landing ----------
function landing() {
  app.innerHTML = `
    <main class="landing">
      <h1>🧭 PR Tour</h1>
      <p>Guided walkthroughs of GitHub pull requests. The tour lives in the PR description, in a collapsed block, so there's nothing to store.</p>
      <form id="go"><input name="url" placeholder="https://github.com/owner/repo/pull/123" autofocus required /><button>Open</button></form>
      <p class="err" id="go-err"></p>
    </main>`;
  $('#go').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = new FormData(e.target as HTMLFormElement).get('url') as string;
    const m = v.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (m) location.href = `/${m[1]}/${m[2]}/pull/${m[3]}`;
    else $('#go-err').textContent = 'That doesn’t look like a GitHub pull request URL.';
  });
}

// ---------- load ----------
async function load(o: string, r: string, n: number) {
  app.innerHTML = `<p class="status">Loading ${esc(`${o}/${r}#${n}`)}…</p>`;
  try {
    const [p, diff] = await Promise.all([getPull(o, r, n, token()), getPullDiff(o, r, n, token())]);
    pull = p;
    files = parse(diff);
    tour = fromHash() ?? extractTour(pull.body) ?? { steps: [] };
    const s = Number(new URLSearchParams(location.search).get('step'));
    current = s >= 1 && s <= tour.steps.length ? s - 1 : 0;
    shell(o, r, n);
    go(current);
  } catch (e) {
    if (e instanceof AuthError) {
      app.innerHTML = `<main class="landing"><h1>🧭 PR Tour</h1><p>${esc(e.message)}</p><button id="signin">Sign in with GitHub</button>
        <details class="pat"><summary>Or use a personal access token</summary>
          <p>A <a href="https://github.com/settings/tokens/new?scopes=repo&description=PR%20Tour" target="_blank" rel="noopener">classic token with the <code>repo</code> scope</a> works on any repo you can read. It stays in this browser only.</p>
          <form id="pat"><input name="t" type="password" placeholder="ghp_…" autocomplete="off" required /><button>Use token</button></form>
        </details></main>`;
      $('#signin').onclick = signIn;
      $('#pat').addEventListener('submit', (ev) => {
        ev.preventDefault();
        store.set(TOKEN, (new FormData(ev.target as HTMLFormElement).get('t') as string).trim());
        location.reload();
      });
    } else {
      app.innerHTML = `<main class="landing"><h1>🧭 PR Tour</h1><p class="err">${esc(String((e as Error).message))}</p></main>`;
    }
  }
}

function fromHash(): Tour | null {
  const m = location.hash.match(/tour=([^&]+)/);
  if (!m) return null;
  try { return fromCodeTour(JSON.parse(LZString.decompressFromEncodedURIComponent(m[1]) ?? 'null')); } catch { return null; }
}

// ---------- layout ----------
function shell(o: string, r: string, n: number) {
  const stale = tour.head && !pull.head.sha.startsWith(tour.head);
  app.innerHTML = `<div class="shell">
    <header>
      <a class="brand" href="/">🧭</a>
      <a class="title" href="${esc(pull.html_url)}" target="_blank" rel="noopener">${esc(pull.title)} <span>${esc(`${o}/${r}#${n}`)}</span></a>
      ${token() ? '<button id="signout" class="ghost">Sign out</button>' : '<button id="signin" class="ghost">Sign in</button>'}
    </header>
    ${stale ? `<div class="banner">This tour was written for commit <code>${esc(tour.head!.slice(0, 7))}</code>; the PR has new commits since, so some lines may have moved.</div>` : ''}
    <div class="layout">
      <aside id="side"></aside>
      <section id="diff"></section>
    </div></div>`;
  $('#diff').innerHTML = html(files, { outputFormat: 'line-by-line', drawFileList: false, matching: 'lines', colorScheme: 'auto' as never });
  document.getElementById('signin')?.addEventListener('click', signIn);
  document.getElementById('signout')?.addEventListener('click', signOut);
  document.addEventListener('keydown', onKey);
}

// ---------- sidebar ----------
function renderSide() {
  const steps = tour.steps;
  $('#side').innerHTML = steps.length ? `
    ${tour.title ? `<h2 class="tour-title">${esc(tour.title)}</h2>` : ''}
    <div class="nav">
      <button id="prev" ${current === 0 ? 'disabled' : ''}>← Prev</button>
      <span>${current + 1} / ${steps.length}</span>
      <button id="next" ${current >= steps.length - 1 ? 'disabled' : ''}>Next →</button>
    </div>
    <ol class="steps">
      ${steps.map((st, i) => `
        <li class="${i === current ? 'active' : ''}" data-i="${i}">
          <strong>${esc(st.title || where(st).split('/').pop() || 'Note')}</strong>
          ${st.file ? `<small>${esc(where(st))}</small>` : ''}
        </li>`).join('')}
    </ol>`
    : '<p class="hint">This PR has no tour yet. Tours are read from a CodeTour JSON block in the PR description.</p>';

  document.getElementById('prev')?.addEventListener('click', () => go(current - 1));
  document.getElementById('next')?.addEventListener('click', () => go(current + 1));
  $('#side').querySelectorAll<HTMLElement>('.steps li').forEach((li) => (li.onclick = () => go(Number(li.dataset.i))));
}

// ---------- navigation & highlighting ----------
function go(i: number) {
  current = Math.max(0, i);
  const url = new URL(location.href);
  if (tour.steps.length) url.searchParams.set('step', String(current + 1)); else url.searchParams.delete('step');
  history.replaceState(null, '', url);
  renderSide();
  highlight();
}

/** `file:line-end` as written in the step, or '' for a plain note. */
function where(s: Step): string {
  if (!s.file) return '';
  return `${s.file}${s.line ? `:${s.line}${s.endLine ? `-${s.endLine}` : ''}` : ''}`;
}

function rowsFor(s: Step): HTMLTableRowElement[] {
  const { file, line } = s;
  if (!file || !line) return [];

  const idx = files.findIndex((f) => f.newName === file);
  const wrapper = $('#diff').querySelectorAll<HTMLElement>('.d2h-file-wrapper')[idx];
  if (!wrapper) return [];
  const end = s.endLine ?? line;
  return [...wrapper.querySelectorAll<HTMLTableRowElement>('tbody tr')].filter((tr) => {
    const n = Number(tr.querySelector('.line-num2')?.textContent?.trim() || NaN);
    return n >= line && n <= end;
  });
}

function noteHtml(s: Step) {
  return `<div class="bubble"><b>${current + 1}/${tour.steps.length}</b> ${s.title ? `<strong>${esc(s.title)}</strong>` : ''}${s.body ? md(s.body) : ''}</div>`;
}

function highlight() {
  $('#diff').querySelectorAll('.tour-hl').forEach((el) => el.classList.remove('tour-hl'));
  $('#diff').querySelectorAll('.tour-note').forEach((el) => el.remove());
  document.querySelector('.missing')?.remove();
  const s = tour.steps[current];
  if (!s) return;
  const rows = rowsFor(s);
  if (!rows.length) {
    $('#side').insertAdjacentHTML('afterbegin', `<div class="missing">${noteHtml(s)}${s.file ? outsideDiff(s) : ''}</div>`);
    return;
  }
  rows.forEach((tr) => tr.classList.add('tour-hl'));
  rows[rows.length - 1].insertAdjacentHTML('afterend', `<tr class="tour-note"><td colspan="2">${noteHtml(s)}</td></tr>`);
  rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function outsideDiff(s: Step): string {
  const anchor = s.line ? `#L${s.line}${s.endLine ? `-L${s.endLine}` : ''}` : '';
  const blob = `https://github.com/${route![1]}/${route![2]}/blob/${pull.head.sha}/${s.file}${anchor}`;
  return `<p>${s.line ? 'This line isn’t' : 'This file isn’t'} part of the diff. <a href="${esc(blob)}" target="_blank" rel="noopener">View it on GitHub ↗</a></p>`;
}

function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowRight' || e.key === 'j') go(Math.min(current + 1, tour.steps.length - 1));
  else if (e.key === 'ArrowLeft' || e.key === 'k') go(current - 1);
}