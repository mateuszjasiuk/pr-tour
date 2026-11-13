# 🧭 PR Tour

Guided walkthroughs of GitHub pull requests. The tour lives **in the PR description**, inside a
collapsed block, so there is no database. Reviewers click the link and step through the diff.

````markdown
🧭 [Take the review tour](https://pr-tour.example.com/acme/api/pull/123)

<details><summary>Review tour</summary>

```json
{
  "title": "Billing changes",
  "ref": "3f2a9c1",
  "steps": [
    { "file": "src/billing/invoice.ts", "line": 42, "title": "Start here", "description": "New proration logic. Supports **bold**, `code`, [links](https://…)." },
    { "file": "src/billing/invoice.ts", "selection": { "start": { "line": 88 }, "end": { "line": 95 } }, "description": "A range of lines" },
    { "title": "Wrap-up", "description": "A step without a file is a plain note" }
  ]
}
```

</details>
````

The tour is a [VS Code CodeTour](https://github.com/microsoft/codetour) (`.tour` JSON) in any fenced
block; the viewer takes the first block that parses as one. Lines point at the new side of the
diff. The viewer only reads tours; it never edits the PR. A tour can also travel in the URL fragment
(`#tour=<lz-string of the CodeTour JSON>`, like mermaid.live), for a PR whose description you can't
edit. The fragment wins over the description.

`ref`, when it is a commit SHA, records the commit the tour was written against. When the PR gets new commits, the viewer
shows a warning that lines may have moved.

Keys: `→`/`j` next, `←`/`k` previous.

## How it works

- `src/`: a static Vite app. It reads the PR and its diff straight from the GitHub API in the
  browser and renders them with [diff2html](https://github.com/rtfpessoa/diff2html).
- `api/login.ts`, `api/callback.ts`: two handlers for GitHub sign-in, served by a
  Cloudflare Worker (`worker/index.ts`) that also serves the static build. They exist only
  because the code-for-token exchange needs the client secret. Nothing is stored server-side: the
  token goes back to the browser in the URL fragment and lives in `localStorage`.
- Public repos work without signing in (GitHub's anonymous rate limit is 60 requests/hour).

## Setup

### 1. Pick how users sign in

Three options, all supported by the same code:

- **Classic OAuth App** (easiest, usually no org admin needed): GitHub → Settings → Developer
  settings → **OAuth Apps → New OAuth App**, callback `https://<your-domain>/api/callback`.
  It requests the `repo` scope and acts as the signed-in user. If the org has *OAuth app access
  restrictions* on, users see a "Request" button on the consent screen and an owner approves once.
- **GitHub App** (finer-grained permissions, needs installing on the org by an owner): below.
- **Personal access token**: no setup. Users paste a classic `repo` token on the sign-in screen.

### GitHub App option

GitHub → org **Settings → Developer settings → GitHub Apps → New GitHub App**:

- **Callback URL:** `https://<your-domain>/api/callback`
- **Webhook:** uncheck *Active*
- **Repository permissions:** *Pull requests: Read-only*, *Contents: Read-only*
- **Where can this app be installed:** *Only on this account*

Then generate a **client secret**, and **Install App** on the org for the repos you want tours on.
User tokens can only reach repos where the app is installed, and only what that user can already
access.

### 2. Deploy to Cloudflare Workers

Cloudflare → **Workers & Pages → Create → Import a repository**. Build command `npm run build`,
deploy command `npx wrangler deploy` (`wrangler.jsonc` has the rest). Then add, under the Worker's
**Settings → Variables and Secrets**:

| Variable | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | The OAuth/GitHub App's Client ID |
| `GITHUB_CLIENT_SECRET` | The client secret from step 1 |

### Local development

```bash
npm install
npm test          # tour-format parser tests
npm run build && npx wrangler dev    # app + sign-in on :8787 (plain `npm run dev` works for public repos)
```

For local sign-in, put the two variables in `.dev.vars` and use an app whose callback is
`http://localhost:8787/api/callback`. A classic OAuth App has only one callback URL, so this needs a
second app.
