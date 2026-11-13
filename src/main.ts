import { parse, html } from 'diff2html';
import type { DiffFile } from 'diff2html/lib/types';
import 'diff2html/bundles/css/diff2html.min.css';
import LZString from 'lz-string';
import './style.css';
import { extractTour, prSnippet, upsertSnippet, type Step, type Tour } from './tour.ts';
import { AuthError, getPull, getPullDiff, updatePullBody, type Pull } from './github.ts';

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
let editing = false;

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
    editing = tour.steps.length === 0;
    shell(o, r, n);
    go(current);
  } catch (e) {
    if (e instanceof AuthError) {
      app.innerHTML = `<main class="landing"><h1>🧭 PR Tour</h1><p>${esc(e.message)}</p><button id="signin">Sign in with GitHub</button></main>`;
      $('#signin').onclick = signIn;
    } else {
      app.innerHTML = `<main class="landing"><h1>🧭 PR Tour</h1><p class="err">${esc(String((e as Error).message))}</p></main>`;
    }
  }
}

function fromHash(): Tour | null {
  const m = location.hash.match(/tour=([^&]+)/);
  if (!m) return null;
  try { return JSON.parse(LZString.decompressFromEncodedURIComponent(m[1]) ?? 'null'); } catch { return null; }
}

// ---------- layout ----------
function shell(o: string, r: string, n: number) {
  const stale = tour.head && !pull.head.sha.startsWith(tour.head);
  app.innerHTML = `<div class="shell">
    <header>
      <a class="brand" href="/">🧭</a>
      <a class="title" href="${esc(pull.html_url)}" target="_blank" rel="noopener">${esc(pull.title)} <span>${esc(`${o}/${r}#${n}`)}</span></a>
      <button id="edit" class="ghost"></button>
      ${token() ? '<button id="signout" class="ghost">Sign out</button>' : '<button id="signin" class="ghost">Sign in</button>'}
    </header>
    ${stale ? `<div class="banner">This tour was written for commit <code>${esc(tour.head!.slice(0, 7))}</code>; the PR has new commits since, so some lines may have moved.</div>` : ''}
    <div class="layout">
      <aside id="side"></aside>
      <section id="diff"></section>
    </div></div>`;
  $('#diff').innerHTML = html(files, { outputFormat: 'line-by-line', drawFileList: false, matching: 'lines', colorScheme: 'auto' as never });
  $('#edit').onclick = () => { editing = !editing; renderSide(); };
  document.getElementById('signin')?.addEventListener('click', signIn);
  document.getElementById('signout')?.addEventListener('click', signOut);
  $('#diff').addEventListener('click', onDiffClick);
  document.addEventListener('keydown', onKey);
}

// ---------- sidebar ----------
function renderSide() {
  $('#edit').textContent = editing ? 'Done editing' : 'Edit tour';
  document.body.classList.toggle('editing', editing);
  const steps = tour.steps;
  const s = steps[current];
  $('#side').innerHTML = `
    ${steps.length ? `
      <div class="nav">
        <button id="prev" ${current === 0 ? 'disabled' : ''}>← Prev</button>
        <span>${current + 1} / ${steps.length}</span>
        <button id="next" ${current >= steps.length - 1 ? 'disabled' : ''}>Next →</button>
      </div>` : ''}
    ${s && editing ? `
      <div class="editor">
        <input id="ed-title" placeholder="Step title" value="${esc(s.title)}" />
        <textarea id="ed-body" rows="5" placeholder="Notes (Markdown: **bold**, \`code\`, [links](https://…))">${esc(s.body)}</textarea>
        <div class="row">
          <button id="up" ${current === 0 ? 'disabled' : ''}>↑</button>
          <button id="down" ${current >= steps.length - 1 ? 'disabled' : ''}>↓</button>
          <button id="del" class="danger">Delete step</button>
        </div>
      </div>` : ''}
    <ol class="steps">
      ${steps.map((st, i) => `
        <li class="${i === current ? 'active' : ''}" data-i="${i}">
          <strong>${esc(st.title || `${st.file.split('/').pop()}:${st.line}`)}</strong>
          <small>${esc(st.file)}:${st.side === 'old' ? '-' : ''}${st.line}${st.endLine ? `-${st.endLine}` : ''}</small>
        </li>`).join('')}
    </ol>
    ${editing ? `
      <p class="hint">${steps.length ? 'Click a line number to add a step after this one. Shift-click extends the current step to a range.' : 'No tour yet. Click a line number in the diff to add the first step.'}</p>
      <div class="actions">
        ${token() ? '<button id="save" class="primary" disabled>Save to PR description</button>' : ''}
        <button id="copy" disabled>Copy snippet</button>
        <button id="link" disabled>Copy share link</button>
        <span id="flash"></span>
      </div>` : ''}`;

  document.getElementById('prev')?.addEventListener('click', () => go(current - 1));
  document.getElementById('next')?.addEventListener('click', () => go(current + 1));
  $('#side').querySelectorAll<HTMLElement>('.steps li').forEach((li) => (li.onclick = () => go(Number(li.dataset.i))));
  if (s && editing) {
    $<HTMLInputElement>('#ed-title').oninput = (e) => { s.title = (e.target as HTMLInputElement).value; refreshNote(); };
    $<HTMLTextAreaElement>('#ed-body').oninput = (e) => { s.body = (e.target as HTMLTextAreaElement).value; refreshNote(); };
    $('#up').onclick = () => move(-1);
    $('#down').onclick = () => move(1);
    $('#del').onclick = () => { steps.splice(current, 1); go(Math.min(current, steps.length - 1)); };
  }
  if (editing) {
    const has = steps.length > 0;
    for (const id of ['save', 'copy', 'link']) { const b = document.getElementById(id) as HTMLButtonElement | null; if (b) b.disabled = !has; }
    document.getElementById('save')?.addEventListener('click', save);
    document.getElementById('copy')?.addEventListener('click', () => copy(prSnippet(tourUrl(), pinned()), 'Snippet copied — paste it into the PR description.'));
    document.getElementById('link')?.addEventListener('click', () =>
      copy(`${tourUrl()}#tour=${LZString.compressToEncodedURIComponent(JSON.stringify(pinned()))}`, 'Share link copied.'));
  }
}

const tourUrl = () => `${location.origin}/${route![1]}/${route![2]}/pull/${route![3]}`;
const pinned = (): Tour => ({ head: pull.head.sha.slice(0, 7), steps: tour.steps });

function move(d: number) {
  const st = tour.steps;
  [st[current], st[current + d]] = [st[current + d], st[current]];
  go(current + d);
}

async function copy(text: string, msg: string) {
  try { await navigator.clipboard.writeText(text); flash(msg); }
  catch { prompt('Copy this:', text); }
}
function flash(msg: string, err = false) {
  const f = document.getElementById('flash');
  if (f) { f.textContent = msg; f.className = err ? 'err' : ''; }
}

async function save() {
  const [o, r, n] = [route![1], route![2], Number(route![3])];
  try {
    const latest = await getPull(o, r, n, token()); // re-read so we don't overwrite someone's edits
    pull = await updatePullBody(o, r, n, token()!, upsertSnippet(latest.body ?? '', tourUrl(), pinned()));
    tour.head = pinned().head;
    flash('Saved to the PR description ✓');
  } catch (e) {
    flash(e instanceof AuthError ? 'Session expired — sign in again.' : `Couldn’t save (${(e as Error).message}). Use “Copy snippet” instead.`, true);
  }
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

function rowsFor(s: Step): HTMLTableRowElement[] {
  const idx = files.findIndex((f) => f.newName === s.file || f.oldName === s.file);
  const wrapper = $('#diff').querySelectorAll<HTMLElement>('.d2h-file-wrapper')[idx];
  if (!wrapper) return [];
  const end = s.endLine ?? s.line;
  return [...wrapper.querySelectorAll<HTMLTableRowElement>('tbody tr')].filter((tr) => {
    const n = Number(tr.querySelector(s.side === 'old' ? '.line-num1' : '.line-num2')?.textContent?.trim() || NaN);
    return n >= s.line && n <= end;
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
    const blob = `https://github.com/${route![1]}/${route![2]}/blob/${pull.head.sha}/${s.file}#L${s.line}${s.endLine ? `-L${s.endLine}` : ''}`;
    $('#side').insertAdjacentHTML('afterbegin',
      `<div class="missing">${noteHtml(s)}<p>This line isn’t part of the diff. <a href="${blob}" target="_blank" rel="noopener">View it on GitHub ↗</a></p></div>`);
    return;
  }
  rows.forEach((tr) => tr.classList.add('tour-hl'));
  rows[rows.length - 1].insertAdjacentHTML('afterend', `<tr class="tour-note"><td colspan="2">${noteHtml(s)}</td></tr>`);
  rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function refreshNote() {
  const s = tour.steps[current];
  const note = document.querySelector('.tour-note td');
  if (s && note) note.innerHTML = noteHtml(s);
  const li = document.querySelector('.steps li.active strong');
  if (s && li) li.textContent = s.title || `${s.file.split('/').pop()}:${s.line}`;
}

// ---------- authoring: click a line number to add a step ----------
function onDiffClick(e: MouseEvent) {
  if (!editing) return;
  const cell = (e.target as HTMLElement).closest('.d2h-code-linenumber');
  const wrapper = cell?.closest('.d2h-file-wrapper');
  if (!cell || !wrapper) return;
  const idx = [...$('#diff').querySelectorAll('.d2h-file-wrapper')].indexOf(wrapper);
  const f = files[idx];
  const newNum = cell.querySelector('.line-num2')?.textContent?.trim();
  const oldNum = cell.querySelector('.line-num1')?.textContent?.trim();
  const side = newNum ? 'new' : 'old';
  const line = Number(newNum || oldNum);
  if (!f || !line) return;
  const file = side === 'new' ? f.newName : f.oldName;

  const cur = tour.steps[current];
  if (e.shiftKey && cur && cur.file === file && cur.side === side) {
    const lo = Math.min(cur.line, line), hi = Math.max(cur.endLine ?? cur.line, line);
    cur.line = lo; cur.endLine = hi > lo ? hi : undefined;
    go(current);
    return;
  }
  const at = tour.steps.length ? current + 1 : 0;
  tour.steps.splice(at, 0, { file, line, side, title: '', body: '' });
  go(at);
  document.getElementById('ed-title')?.focus();
}

function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement).closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowRight' || e.key === 'j') go(Math.min(current + 1, tour.steps.length - 1));
  else if (e.key === 'ArrowLeft' || e.key === 'k') go(current - 1);
  else if (e.key === 'e') { editing = !editing; renderSide(); }
}
