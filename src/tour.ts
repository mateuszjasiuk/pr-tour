// A tour is a VS Code CodeTour (https://aka.ms/codetour-schema) in a fenced block of the PR
// description, usually inside a collapsed <details>:
//
//   ```json
//   { "title": "Billing", "ref": "3f2a9c1", "steps": [
//     { "file": "src/billing/invoice.ts", "line": 42, "title": "Start here", "description": "Markdown" },
//     { "file": "src/foo.ts", "selection": { "start": { "line": 88 }, "end": { "line": 95 } }, "description": "A range" },
//     { "title": "Wrap-up", "description": "A step without a file is a plain note" }
//   ] }
//   ```

export interface Step {
  file?: string;
  line?: number;
  endLine?: number;
  title: string;
  body: string;
}

export interface Tour {
  title?: string;
  /** Commit the tour was written against, to warn when the PR has moved on. */
  head?: string;
  steps: Step[];
}

const FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;

/** Finds the first fenced block in the description that holds a CodeTour. */
export function extractTour(markdown: string | null | undefined): Tour | null {
  if (!markdown) return null;

  for (const m of markdown.replace(/\r\n/g, '\n').matchAll(FENCE)) {
    try {
      const tour = fromCodeTour(JSON.parse(m[2]));
      if (tour) return tour;
    } catch {}
  }
  return null;
}

/** Maps a parsed CodeTour object to a tour, or null when it isn't one. */
export function fromCodeTour(json: unknown): Tour | null {
  if (!isObject(json) || !Array.isArray(json.steps)) return null;

  const ref = typeof json.ref === 'string' && /^[0-9a-f]{7,40}$/i.test(json.ref) ? json.ref : undefined;
  return {
    title: str(json.title) || undefined,
    head: ref,
    steps: json.steps.filter(isObject).map(toStep),
  };
}

function toStep(s: Record<string, unknown>): Step {
  const sel = isObject(s.selection) ? s.selection : undefined;
  const start = num(isObject(sel?.start) ? sel.start.line : undefined);
  const end = num(isObject(sel?.end) ? sel.end.line : undefined);
  const line = num(s.line) ?? start;
  const file = str(s.file).replace(/^\.?\//, '') || undefined;

  return {
    file,
    line: file ? line : undefined,
    endLine: file && line && end && end > line ? end : undefined,
    title: str(s.title),
    body: str(s.description).trim(),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);
