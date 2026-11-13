# 🧭 PR Tour

Guided walkthroughs of GitHub pull requests. The tour lives **in the PR description**, inside a
collapsed block, so there is no database. Reviewers click the link and step through the diff.

````markdown
🧭 [Take the review tour](https://pr-tour.example.com/acme/api/pull/123)

<details><summary>Review tour</summary>

```tour head=3f2a9c1
1. src/billing/invoice.ts:42 — Start here: new proration logic
   Optional notes, indented under the step. Supports **bold**, `code`, [links](https://…).
2. src/billing/invoice.ts:88-95 — A range of lines
3. src/legacy.ts:-17 — A leading minus points at the old (deleted) side
```

</details>
````

You don't have to write this by hand. Open `/<owner>/<repo>/pull/<n>`, click **Edit tour**, click
line numbers in the diff to add steps (Shift-click extends a step to a range), then use
**Save to PR description** or **Copy snippet**. **Copy share link** gives an ad-hoc tour packed
into the URL fragment (`#tour=…`, like mermaid.live) without touching the PR.

`head=` records the commit the tour was written against. When the PR gets new commits, the viewer
shows a warning that lines may have moved.

Keys: `→`/`j` next, `←`/`k` previous, `e` toggle editing.

## How it works

- `src/`: a static Vite app. It reads the PR and its diff straight from the GitHub API in the
  browser and renders them with [diff2html](https://github.com/rtfpessoa/diff2html).
- `api/login.ts`, `api/callback.ts`: two Vercel functions for GitHub sign-in. They exist only
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
- **Repository permissions:** *Pull requests: Read and write* (write is only used by
  "Save to PR description"; Read-only works if you prefer copy/paste), *Contents: Read-only*
- **Where can this app be installed:** *Only on this account*

Then generate a **client secret**, and **Install App** on the org for the repos you want tours on.
User tokens can only reach repos where the app is installed, and only what that user can already
access.

### 2. Deploy to Vercel

Import the repo in Vercel (framework preset: Vite) and set the environment variables:

| Variable | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | The OAuth/GitHub App's Client ID |
| `GITHUB_CLIENT_SECRET` | The client secret from step 1 |

### Local development

```bash
npm install
npm test          # tour-format parser tests
npx vercel dev    # app + sign-in functions (plain `npm run dev` works for public repos)
```

For local sign-in, add `http://localhost:3000/api/callback` as an extra callback URL on the App.
