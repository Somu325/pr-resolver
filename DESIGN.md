# PR Resolver Agent — Design Document

## 1. Problem statement

Code review comments on GitHub PRs require a human to read the comment, understand the code, write a fix, commit it, push it, and reply to the thread. This is repetitive for small, well-scoped comments (rename a variable, add a null check, fix a typo, extract a constant).

**Goal:** an agent that watches PRs, proposes a precise fix the moment a reviewer leaves a comment, and applies it to the branch once a human approves — collapsing a 5-step manual chore into "read suggestion, click approve."

**Explicit non-goal:** this is not meant to resolve every comment. Large architectural feedback, ambiguous comments, or anything needing design judgment should be left alone or flagged as "couldn't generate a confident fix." Scope is small, mechanical, well-defined fixes.

---

## 2. Design principles

1. **Event-driven, not polling.** The agent reacts to a webhook the instant a comment is posted. No cron job repeatedly asking "anything new?"
2. **Human is the only write gate.** The agent may read anything and *propose* anything autonomously. It may never push code or reply to GitHub without an explicit approve action from a person. This is the single non-negotiable rule in the system.
3. **Idempotent by construction.** GitHub redelivers webhooks on failure. The same comment ID arriving twice must never produce two suggestions or two Gemini calls. The database enforces this, not application logic alone.
4. **Small blast radius per fix.** The agent edits a line range, never a whole file. A wrong AI suggestion should be trivially diffable and trivially rejectable — never a silent full-file rewrite a human has to carefully audit.
5. **Fast webhook ACK, slow work happens after.** GitHub expects a response within ~10s or it considers the delivery failed. The webhook handler's only synchronous job is "acknowledge and record"; the actual fetch-file → call-Gemini → save pipeline runs after the response is sent.
6. **Stateless API calls into GitHub, stateful tracking in our own DB.** GitHub is the source of truth for code and comments. We never duplicate that — we only track *what we've done about it* (which comments we've seen, what we proposed, what was approved).

---

## 3. System architecture

```
                              ┌────────────────────┐
                              │      GitHub         │
                              │ (repo, PRs, comments,│
                              │  OAuth, webhooks)    │
                              └─────────┬────────────┘
                  webhook: new comment  │  OAuth login redirect
                  ───────────────────►  │  ◄───────────────────
                                        │
                              ┌─────────▼────────────┐
                              │       Backend          │
                              │   (Node + Express)      │
                              │                          │
                              │  Auth layer              │
                              │  Webhook receiver         │
                              │  Agent pipeline            │
                              │  GitHub write actions       │
                              │  REST API for dashboard      │
                              └─────────┬────────────────────┘
                          ┌─────────────┼──────────────┐
                          ▼             ▼              ▼
                  ┌──────────────┐ ┌──────────┐ ┌──────────────┐
                  │   MongoDB     │ │  Gemini   │ │  React        │
                  │ (suggestions, │ │  API      │ │  Dashboard     │
                  │  users, repos)│ │           │ │  (approve UI)   │
                  └──────────────┘ └──────────┘ └──────────────┘
```

### Component responsibilities

**GitHub** — source of truth for code, PRs, and comments. Sends us webhook events. Receives our OAuth-authenticated write calls (commits, replies).

**Backend** — everything happens here. Owns the agent pipeline, talks to Gemini, talks to MongoDB, exposes a REST API the dashboard consumes. The dashboard never talks to GitHub or Gemini directly — always through the backend.

**MongoDB** — tracks agent state: which comments have been processed, what was suggested, what a human decided. Does not store code or duplicate anything GitHub already owns.

**Gemini** — stateless fix-generation function. Given a comment + code context, returns a structured fix. No memory between calls; all context is passed in explicitly each time.

**React Dashboard** — read/write surface for humans. Shows pending suggestions, lets you approve or reject. Optionally, a secondary view to browse repos/PRs/comments manually (useful for testing without waiting on real webhook traffic).

---

## 4. The agent pipeline (core loop)

This is the heart of the system — everything else exists to support this loop.

```
1. TRIGGER
   GitHub webhook fires: pull_request_review_comment, action=created
        │
        ▼
2. ACK
   Server responds 200 immediately (no processing yet)
        │
        ▼
3. DEDUPE
   Has this comment_id been seen before? → if yes, stop here
        │ no
        ▼
4. FETCH CONTEXT
   Get the file content at the comment's exact commit_id
   Extract a window of lines around the comment (not the whole file)
        │
        ▼
5. GENERATE FIX
   Send comment text + line-numbered code context to Gemini
   Force structured output: { startLine, endLine, newCode, explanation, confidence }
        │
        ▼
6. PERSIST
   Save as a Suggestion document, status = "pending"
   (pipeline ends here — no GitHub write has happened yet)
        │
        ▼
   ─────────────── human checkpoint ───────────────
        │
        ▼
7. REVIEW
   Human opens dashboard, sees the suggestion with a before/after diff
        │
   ┌────┴────┐
   ▼         ▼
 REJECT    APPROVE
   │         │
   │         ▼
   │    8. APPLY
   │       Fetch current file SHA on the PR branch
   │       Splice newCode into [startLine, endLine]
   │       Commit to the PR's existing branch
   │       Reply to the original comment thread
   │       status = "applied"
   │
   ▼
 status = "rejected"
 (no GitHub write)
```

**Why a confidence field in step 5:** not every comment is fixable mechanically ("this whole approach is wrong" has no line-range fix). Gemini should be able to return a low confidence score or a null fix, and the dashboard should surface that distinctly ("couldn't generate a confident fix — needs human review") rather than presenting a bad guess as if it were solid.

---

## 5. Data model

```
Suggestion
──────────
_id
owner                 string
repo                  string
prNumber              int
prHeadBranch          string   — needed at commit time, branch name not derivable from owner/repo alone
commentId             int      — UNIQUE INDEX, this is the dedupe key
commentBody           string
filePath              string
commentLine           int
startLine             int
endLine               int
originalCode          string   — snapshot at generation time, for diff rendering
suggestedCode         string
explanation           string
confidence            "high" | "low" | "none"
status                "pending" | "approved" | "rejected" | "applied" | "failed"
createdAt             datetime
resolvedAt            datetime | null
appliedCommitSha      string | null   — set after a successful apply, for audit/debugging

User
────
_id
githubId
githubLogin
accessToken           — encrypted at rest before any real deployment
createdAt

WatchedRepo            (a repo the user has explicitly enabled the agent on)
───────────
_id
userId
owner
repo
webhookId             — GitHub's id for the registered webhook, needed to delete/manage it later
createdAt
```

**Why `WatchedRepo` exists:** the agent shouldn't silently act on every repo a user can access just because they logged in once. A user explicitly opts a repo in, which is also the moment we register the webhook on GitHub's side.

---

## 6. API surface

```
Auth
  GET  /auth/github                redirect to GitHub OAuth consent
  GET  /auth/callback              exchange code for token, create/update User

Repo management
  GET  /repos                      list repos the user can access
  POST /repos/:owner/:repo/watch   register webhook, create WatchedRepo
  DELETE /repos/:owner/:repo/watch remove webhook, delete WatchedRepo

Agent (internal, triggered by GitHub — not called by the frontend)
  POST /webhook                    receives all GitHub webhook events

Dashboard (called by the frontend)
  GET  /suggestions?status=pending list suggestions awaiting review
  POST /suggestions/:id/approve    apply the fix to GitHub
  POST /suggestions/:id/reject     mark rejected, no GitHub write

Manual/debug (optional, for testing without live webhook traffic)
  GET  /repos/:owner/:repo/pulls            list open PRs
  GET  /repos/:owner/:repo/pulls/:n/comments list comments on a PR
  POST /debug/process-comment               manually run the pipeline on one comment
```

Note what's deliberately absent: there is no frontend-facing route that calls Gemini or writes to GitHub directly. Every AI call and every GitHub write happens inside the pipeline or the approve route — never as a side effect of a GET request the dashboard makes casually.

---

## 7. Build phases

Each phase has a single testable outcome. Don't start a phase until the previous one's outcome is demonstrable.

### Phase 1 — Auth & repo access
Build OAuth login. User can authenticate and the backend can list their repos.
**Outcome:** logging in shows a real list of the user's GitHub repos in the dashboard.

### Phase 2 — Manual pipeline (no webhook yet)
Build the fetch-file → generate-fix steps as a manually-triggered debug route. This isolates and proves the hardest part (structured Gemini output) before adding the complexity of webhooks.
**Outcome:** calling `/debug/process-comment` with a real comment ID returns an accurate, structured `{startLine, endLine, newCode, explanation}` fix — verified by eye against the actual file.

### Phase 3 — Persistence
Wire the pipeline output into MongoDB as `Suggestion` documents instead of just returning JSON.
**Outcome:** running the debug route twice on the same comment produces exactly one document, not two (dedupe logic proven before webhooks introduce real retry behavior).

### Phase 4 — Webhook trigger
Replace the manual debug trigger with a real GitHub webhook. Local dev needs a tunnel (ngrok or equivalent) since GitHub can't reach localhost.
**Outcome:** posting a real comment on a watched PR — zero clicks — produces a new pending `Suggestion` in the database within seconds.

### Phase 5 — Dashboard review UI
Build the React view that lists pending suggestions with a diff and approve/reject buttons, backed by `/suggestions`.
**Outcome:** the suggestion from Phase 4 is visible in the UI with a readable before/after diff.

### Phase 6 — Approve → apply
Build the approve route: fetch SHA, splice code, commit, reply to comment thread.
**Outcome:** clicking Approve in the dashboard produces a real commit on the PR branch and a real reply on GitHub — the full loop closed, zero manual git/GitHub interaction.

### Phase 7 — Repo opt-in flow
Replace manually registering webhooks via GitHub's UI with the `/repos/:owner/:repo/watch` route, so a user enables the agent on a repo from inside the dashboard.
**Outcome:** clicking "Watch this repo" in the UI is the only setup step needed — no visiting GitHub's webhook settings by hand.

### Phase 8 — Hardening (do only after 1–7 work end to end)
- Verify webhook payload signatures (`X-Hub-Signature-256`) so `/webhook` can't be spoofed.
- Encrypt stored access tokens at rest.
- Add a "low confidence" UI treatment so weak suggestions are visually distinct from solid ones.
- Add rate limiting on Gemini calls per user per hour.
- Move off ngrok to a real deployed URL for a stable webhook endpoint.

---

## 8. Key risks and how the design addresses them

| Risk | Mitigation already in the design |
|---|---|
| Webhook redelivery causes duplicate work | `commentId` unique index — second insert fails cleanly |
| Slow Gemini call causes GitHub to mark webhook failed | ACK happens before any Gemini/file-fetch call |
| AI proposes a bad fix that gets blindly trusted | Human approval is mandatory; confidence field flags weak suggestions |
| AI rewrites unrelated code | Fix is constrained to an explicit line range, never a full file |
| Agent acts on repos the user never intended to enable | Explicit opt-in via `WatchedRepo`, not "every repo I can see" |
| File changed between comment and approval (stale SHA) | Approve step always fetches the current SHA right before committing, not a cached one from suggestion-generation time |

---

## 9. Tech stack

```
Frontend    React + Vite
Backend     Node.js + Express
Database    MongoDB (Mongoose)
AI          Gemini API (structured output / responseSchema)
Auth        GitHub OAuth App
Tunnel      ngrok (local dev only)
```
