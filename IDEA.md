# PR Resolver Agent — Architecture & Build Plan

> An agent that watches GitHub PR review comments and proposes targeted code fixes using Gemini, with human approval before anything gets pushed.

---

## 0. Mental model — what makes this an "agent"

A tool waits for a user to click. An agent has three things a tool doesn't:

| Capability | Tool (what we built first) | Agent (what we're building now) |
|---|---|---|
| **Trigger** | User clicks "Fetch Comments" | GitHub webhook fires automatically when a comment is posted |
| **Loop** | User clicks "Resolve" per comment | Server reacts to each incoming event on its own |
| **Memory** | None — refetches everything every time | Tracks which comments are already processed, so it doesn't redo work |

Human approval (your Option B choice) stays as the one manual checkpoint — the agent does everything else (fetch file, generate fix, prepare diff) without you driving each step. You only act at the approve/reject gate.

```
GitHub comment posted
        ↓ (webhook — automatic)
Server receives event
        ↓ (agent loop — automatic)
Fetch file at comment's commit
        ↓ (automatic)
Gemini generates targeted fix (structured JSON: startLine, endLine, newCode)
        ↓ (automatic)
Suggestion saved to DB, status = "pending"
        ↓
─────────────── human checkpoint ───────────────
User opens dashboard → sees queue of pending suggestions (already generated)
User clicks Approve
        ↓ (automatic again)
Server commits fix to PR branch + replies to the original comment
```

---

## 1. Final architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                              GitHub                                   │
│  (repo, PR, review comments, webhooks, OAuth)                         │
└───────────────┬─────────────────────────────────┬─────────────────────┘
                 │ webhook POST                     │ OAuth login
                 ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Backend (Node/Express)                        │
│                                                                          │
│  /auth/github, /auth/callback   → OAuth login                          │
│  /webhook                       → receives GitHub events               │
│  /repos, /repos/:o/:r/pulls     → list repos & PRs (manual fallback)   │
│  /file-content                  → fetch file at a specific commit      │
│  /generate-fix                  → Gemini call, structured JSON output  │
│  /suggestions  (GET/POST)       → CRUD on pending suggestions          │
│  /suggestions/:id/approve       → commit fix + reply to comment        │
│                                                                          │
│  Database: stores comment → suggestion → status (pending/approved/     │
│  rejected) so we never reprocess the same comment twice                │
└───────────────┬──────────────────────────────────┬─────────────────────┘
                 │                                   │
                 ▼                                   ▼
        ┌─────────────────┐                ┌──────────────────┐
        │   Gemini API     │                │  React Frontend   │
        │  (fix generation)│                │  (dashboard)       │
        └─────────────────┘                └──────────────────┘
```

---

## 2. What's already built (recap)

These phases are DONE — don't redo them, just verify they still work if you've been away from the project for a while.

- [x] **Phase 0 — Monorepo setup**: `pr-agent/` (React + Vite) and `server/` (Express) folders, single root `.gitignore` with `**/node_modules`, `**/.env`.
- [x] **Phase 1 — Manual PR comment viewer**: `/pr-comments?owner&repo&prNumber` route using a personal access token. React UI lists comments with a "Resolve with AI" button.
- [x] **Phase 2 — Gemini integration (unstructured)**: `/resolve-comment` route sends comment + diff_hunk to Gemini, returns free-text suggestion. Displayed in UI.
- [x] **Phase 3 — GitHub OAuth**: `/auth/github` and `/auth/callback` routes. Frontend captures `?token=` from redirect, stores in state, shows "Connected" badge.
- [x] **Phase 4 — Dynamic repo/PR selection**: `/repos` and `/repos/:owner/:repo/pulls` routes using the user's OAuth token (not personal token). Cascading dropdowns replaced manual owner/repo/PR text inputs.

**Known gaps in what's built so far:**
- OAuth token currently passed via URL query param and kept only in React state (lost on refresh). Needs to move to a persistent, secure store (see Phase 6).
- `/resolve-comment` returns free text, not structured data — can't be programmatically applied to a file. Being replaced in Phase 5.
- Nothing is automatic yet — every action requires a button click. Being replaced in Phase 7 (webhook).

---

## 3. Remaining phases — in build order

### Phase 5 — Structured fix generation

**Goal:** Replace free-text Gemini suggestions with a structured fix the server can programmatically apply to a file.

**5.1 — Fetch file content at the comment's commit**

Route: `GET /file-content?owner&repo&path&commitId`

Uses `comment.commit_id` (already present in every PR comment payload) to fetch the *exact* version of the file the comment was made against — not whatever the branch currently looks like.

```js
app.get('/file-content', async (req, res) => {
  const userToken = req.headers.authorization
  const { owner, repo, path, commitId } = req.query

  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${commitId}`,
    {
      headers: {
        Authorization: userToken,
        Accept: 'application/vnd.github.raw'
      }
    }
  )

  res.json({ content: response.data })
})
```

Test:
```bash
curl -H "Authorization: Bearer YOUR_OAUTH_TOKEN" \
  "http://localhost:8000/file-content?owner=Somu325&repo=Booking&path=src/App.tsx&commitId=<commit_id_from_comment>"
```

**5.2 — Structured Gemini fix generation**

Route: `POST /generate-fix`

Body: `{ owner, repo, path, commitId, comment: { body, line, diff_hunk } }`

Server-side steps:
1. Call `/file-content` internally (or just reuse the fetch logic) to get full file text.
2. Split into lines, take a context window around `comment.line` (e.g. ±15 lines) — don't send the whole file if it's huge, send enough context for Gemini to understand it.
3. Call Gemini with `responseSchema` to force structured JSON output (not just a prompt asking nicely for JSON — use the SDK's actual schema enforcement):

```js
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: SchemaType.OBJECT,
      properties: {
        startLine: { type: SchemaType.INTEGER },
        endLine: { type: SchemaType.INTEGER },
        newCode: { type: SchemaType.STRING },
        explanation: { type: SchemaType.STRING }
      },
      required: ['startLine', 'endLine', 'newCode', 'explanation']
    }
  }
})

app.post('/generate-fix', async (req, res) => {
  const { fileContent, comment } = req.body
  const lines = fileContent.split('\n')
  const contextStart = Math.max(0, comment.line - 15)
  const contextEnd = Math.min(lines.length, comment.line + 15)
  const contextLines = lines.slice(contextStart, contextEnd)
    .map((line, i) => `${contextStart + i + 1}: ${line}`)
    .join('\n')

  const prompt = `
You are fixing a specific code review comment.

Reviewer comment: "${comment.body}"
Comment is on line: ${comment.line}

Code context (with line numbers):
${contextLines}

Return the exact line range to replace and the replacement code.
Keep the fix minimal and scoped only to what the comment asks for.
Do not reformat or change unrelated lines.
`

  const result = await model.generateContent(prompt)
  const fix = JSON.parse(result.response.text())

  res.json(fix)
})
```

Why `responseSchema` instead of just prompting for JSON: free-text JSON-in-a-prompt is unreliable — models wrap it in markdown fences, add commentary, etc. `responseSchema` is the SDK's actual structured-output mode, the model is constrained server-side by Google, not just instructed.

**5.3 — Diff preview in UI**

Frontend: replace the call to `/resolve-comment` with a call to `/generate-fix`. Render a before/after diff using `startLine`/`endLine`/`newCode` — a simple side-by-side or unified diff view (you can use a library like `react-diff-viewer` or build a minimal version by just highlighting the replaced lines).

**Definition of done for Phase 5:** clicking "Resolve with AI" on a comment shows a precise before/after code diff (not paragraph text), with an explanation, and an Approve/Reject button.

---

### Phase 6 — Persistence layer

**Goal:** Stop losing state on every refresh. Track which comments have been processed so the agent doesn't redo work.

You're a MERN dev — use MongoDB, it's the natural fit here.

**6.1 — Schema**

```js
// Suggestion
{
  _id,
  owner,
  repo,
  prNumber,
  commentId,        // GitHub comment id — unique per comment
  commentBody,
  filePath,
  startLine,
  endLine,
  originalCode,
  suggestedCode,
  explanation,
  status,           // "pending" | "approved" | "rejected" | "applied"
  createdAt,
  resolvedAt
}

// User (optional but recommended)
{
  _id,
  githubId,
  githubLogin,
  accessToken,      // encrypted at rest, see security note below
  createdAt
}
```

**6.2 — Why this matters for "agent" behavior**

Without persistence, every webhook event would have to synchronously generate a fix and show it to whoever happens to have the dashboard open — fragile. With persistence:
- Webhook fires → fix gets generated → saved to DB with `status: "pending"` → done. The webhook handler's job ends here, fast.
- Dashboard separately queries `GET /suggestions?status=pending` whenever the user opens it — decoupled from the webhook timing entirely.
- `commentId` uniqueness lets you check "have I already processed this comment?" before calling Gemini again — prevents duplicate API calls if GitHub redelivers a webhook (it does this on failures).

**6.3 — Security note on storing tokens**

If you store user OAuth tokens in MongoDB (needed for the agent to act on their behalf later, e.g. via webhook with no user present), encrypt them at rest — don't store raw `gho_...` tokens in plaintext. Use a library like `crypto` (built into Node) with a key from `.env`, or a service like AWS KMS if this ever goes to production. For local dev/learning, plaintext is fine — just don't skip this if you ever deploy it for real use.

**Definition of done for Phase 6:** suggestions persist across server restarts and browser refreshes; re-delivering the same webhook event doesn't create duplicate suggestions.

---

### Phase 7 — Webhook (the actual "agent" trigger)

**Goal:** React to new PR comments automatically, no button click.

**7.1 — Local tunnel (dev only)**

GitHub can't reach `localhost`. Use ngrok to expose your local server:

```bash
brew install ngrok
ngrok http 8000
```

Gives you a public URL like `https://a1b2-c3d4.ngrok-free.app` that forwards to `localhost:8000`. This URL changes every time you restart ngrok on the free tier — expect to re-register the webhook URL each dev session, or get a static domain on ngrok's paid tier if this gets annoying.

**7.2 — Webhook route**

```js
app.post('/webhook', express.json(), async (req, res) => {
  // respond fast — GitHub times out webhook deliveries after 10s
  res.status(200).send('received')

  const event = req.headers['x-github-event']
  if (event !== 'pull_request_review_comment') return

  const action = req.body.action
  if (action !== 'created') return // ignore edits/deletes for now

  const comment = req.body.comment
  const pr = req.body.pull_request
  const repo = req.body.repository

  // check DB: already processed this comment?
  const existing = await Suggestion.findOne({ commentId: comment.id })
  if (existing) return

  // run the agent loop
  await processComment({
    owner: repo.owner.login,
    repo: repo.name,
    prNumber: pr.number,
    comment
  })
})

async function processComment({ owner, repo, prNumber, comment }) {
  const fileContent = await fetchFileContent({ owner, repo, path: comment.path, commitId: comment.commit_id })
  const fix = await generateFix({ fileContent, comment })

  await Suggestion.create({
    owner, repo, prNumber,
    commentId: comment.id,
    commentBody: comment.body,
    filePath: comment.path,
    startLine: fix.startLine,
    endLine: fix.endLine,
    suggestedCode: fix.newCode,
    explanation: fix.explanation,
    status: 'pending'
  })
}
```

Important detail: **respond to GitHub with `200` immediately**, before doing any of the slow work (file fetch, Gemini call). GitHub expects a fast ack and will mark the delivery failed/retry if you take too long — let the actual processing happen after you've already responded.

**7.3 — Register the webhook**

Per-repo, manually for now (automating webhook registration per-repo-on-OAuth-login is a nice Phase 9 upgrade, not needed yet):

1. Repo → Settings → Webhooks → Add webhook
2. Payload URL: your ngrok URL + `/webhook`
3. Content type: `application/json`
4. Events: select individual events → **Pull request review comments**
5. Save

**7.4 — Test**

Post a new review comment on a PR → watch your server logs → confirm a `Suggestion` document appears in MongoDB with `status: "pending"`, without you clicking anything in the UI.

**Definition of done for Phase 7:** posting a GitHub PR comment, with zero clicks on your end, results in a pending suggestion appearing in the database within a few seconds.

---

### Phase 8 — Approval & commit-back

**Goal:** Close the loop — approving a suggestion actually pushes the fix and replies to the comment.

**8.1 — Dashboard: pending suggestions queue**

Route: `GET /suggestions?status=pending` → React fetches this on dashboard load (not tied to any specific repo/PR selection — shows everything pending across all repos the user has).

UI: list of cards, each showing repo, PR, file, comment text, diff preview, Approve/Reject buttons.

**8.2 — Approve route**

```js
app.post('/suggestions/:id/approve', async (req, res) => {
  const suggestion = await Suggestion.findById(req.params.id)
  const userToken = req.headers.authorization

  // 1. get current file SHA (required by GitHub's update-file API)
  const { data: fileData } = await axios.get(
    `https://api.github.com/repos/${suggestion.owner}/${suggestion.repo}/contents/${suggestion.filePath}`,
    { headers: { Authorization: userToken } }
  )

  // 2. splice the fix into the current file content
  const currentContent = Buffer.from(fileData.content, 'base64').toString('utf-8')
  const lines = currentContent.split('\n')
  const before = lines.slice(0, suggestion.startLine - 1)
  const after = lines.slice(suggestion.endLine)
  const newContent = [...before, suggestion.suggestedCode, ...after].join('\n')

  // 3. commit the updated file
  await axios.put(
    `https://api.github.com/repos/${suggestion.owner}/${suggestion.repo}/contents/${suggestion.filePath}`,
    {
      message: `Fix: ${suggestion.commentBody.slice(0, 60)}`,
      content: Buffer.from(newContent).toString('base64'),
      sha: fileData.sha,
      branch: suggestion.prHeadBranch // need to store this on the suggestion too
    },
    { headers: { Authorization: userToken } }
  )

  // 4. reply to the original comment
  await axios.post(
    `https://api.github.com/repos/${suggestion.owner}/${suggestion.repo}/pulls/${suggestion.prNumber}/comments/${suggestion.commentId}/replies`,
    { body: `✅ Fixed automatically. ${suggestion.explanation}` },
    { headers: { Authorization: userToken } }
  )

  suggestion.status = 'applied'
  suggestion.resolvedAt = new Date()
  await suggestion.save()

  res.json({ status: 'applied' })
})
```

Note: you'll need to capture `pull_request.head.ref` (the branch name) from the webhook payload and store it on the `Suggestion` document — added as `prHeadBranch` above — since the commit API needs a branch name, not just owner/repo.

**8.3 — Reject route**

```js
app.post('/suggestions/:id/reject', async (req, res) => {
  await Suggestion.findByIdAndUpdate(req.params.id, { status: 'rejected', resolvedAt: new Date() })
  res.json({ status: 'rejected' })
})
```

**Definition of done for Phase 8:** clicking Approve on a dashboard card results in a real commit appearing on the PR branch on GitHub, and a reply appearing under the original comment thread — fully closing the loop without you touching git or GitHub directly.

---

### Phase 9 — Polish (optional, after core loop works)

Only tackle these once Phases 5-8 work end to end. Roughly easiest → hardest:

- **Race condition guard**: if two webhook deliveries for the same comment arrive close together (GitHub does retry), make `commentId` a unique index in MongoDB so the second insert fails cleanly instead of creating a duplicate.
- **Token storage**: move OAuth token from URL-param/React-state to an httpOnly cookie + server-side session, so refreshing the page doesn't log the user out and the token isn't exposed in browser history.
- **Auto-register webhooks**: when a user connects a repo via the dashboard (instead of manually via GitHub settings), call `POST /repos/:owner/:repo/hooks` on their behalf using their OAuth token.
- **Multi-comment batching**: if a PR gets 5 comments in quick succession, batch them into one Gemini call / one commit instead of 5 separate commits.
- **Production webhook URL**: replace ngrok with a real deployed backend (Railway, Render, Fly.io all have generous free tiers) so the webhook URL is stable and doesn't require your laptop to be on.
- **Rate limiting / cost control**: cap how many Gemini calls happen per hour per user, since an autonomous trigger means you're no longer manually gating API spend by clicking.

---

## 4. Quick reference — environment variables needed by the end

```
# server/.env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_TOKEN=              # only used in early manual-flow testing, can remove later
GEMINI_API_KEY=
MONGODB_URI=
WEBHOOK_SECRET=            # optional but recommended: verify webhook payloads are really from GitHub
```

On `WEBHOOK_SECRET`: GitHub lets you set a secret when registering a webhook, then signs every payload with it (`X-Hub-Signature-256` header). Verifying this signature stops anyone who finds your ngrok URL from POSTing fake events to your `/webhook` route. Worth adding once Phase 7 is otherwise working — not a blocker to get the happy path running first.

---

## 5. Suggested order to resume work

If you're picking this up fresh in a new session, work top to bottom:

1. Confirm Phase 0-4 still work (login, repo/PR dropdowns, comments load).
2. Phase 5 — structured fix generation. This is the most "AI engineering" heavy part — budget the most time here, especially tuning the prompt/context-window size.
3. Phase 6 — MongoDB persistence. Mechanical, fast if you've used Mongoose before.
4. Phase 7 — webhook + ngrok. Mostly plumbing, the satisfying "it's alive" moment.
5. Phase 8 — approve/commit-back. This is where it becomes a real agent — closes the loop.
6. Phase 9 — pick off polish items as needed, roughly in the order listed.
