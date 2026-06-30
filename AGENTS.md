# AGENTS.md

## PR Resolver Agent

### What this agent does

Watches GitHub pull requests for new review comments. When a comment is posted, it automatically generates a precise, line-scoped code fix using the Gemini API and queues it for human review. On approval, it commits the fix directly to the PR's branch and replies to the original comment thread. It never writes to GitHub without explicit human approval.

---

### Trigger

GitHub webhook — event `pull_request_review_comment`, action `created`.

Not polling. Not manually invoked in normal operation. The agent is dormant until GitHub sends it an event.

---

### Inputs

Per invocation, the agent receives from the webhook payload:

- `comment.id` — unique identifier, used for deduplication
- `comment.body` — the reviewer's comment text
- `comment.path` — file the comment is on
- `comment.line` — line number the comment targets
- `comment.commit_id` — exact commit SHA the comment was made against
- `pull_request.number`
- `pull_request.head.ref` — branch name to eventually commit to
- `repository.owner.login`, `repository.name`

---

### Pipeline

```
1. Acknowledge webhook (HTTP 200) immediately, before any processing
2. Check if comment.id already exists in the database — if so, stop (dedupe)
3. Fetch file content at comment.commit_id (not branch HEAD — exact snapshot)
4. Extract a context window of lines around comment.line (~±15 lines)
5. Call Gemini with comment + line-numbered context, forcing structured JSON output:
   { startLine, endLine, newCode, explanation, confidence }
6. Save result as a Suggestion document, status = "pending"
7. STOP — no GitHub write happens automatically past this point
```

Human review happens outside the agent's automatic flow, via a dashboard.

---

### Output contract

The agent must always produce one of:

```json
{
  "startLine": 42,
  "endLine": 44,
  "newCode": "const userId = getUserId();",
  "explanation": "Renamed variable for clarity per reviewer comment.",
  "confidence": "high"
}
```

or, when no safe mechanical fix exists:

```json
{
  "startLine": null,
  "endLine": null,
  "newCode": null,
  "explanation": "Comment requires architectural judgment, not a line-level fix.",
  "confidence": "none"
}
```

The agent must never return free-text prose as its primary output. Structured fields only — enforced via the model's `responseSchema`, not prompt instruction alone.

---

### Constraints

- **Never commits without explicit human approval.** This is the one inviolable rule. Approval is a separate, manually-triggered action (`POST /suggestions/:id/approve`), never part of the automatic pipeline.
- **Never edits outside the given line range.** No full-file rewrites, no "while I'm here" cleanup of unrelated code.
- **Never reprocesses a comment it has already seen.** `comment.id` is a unique key in storage; duplicate webhook deliveries (GitHub retries on failure) must not produce duplicate suggestions or duplicate Gemini calls.
- **Never fetches the live branch HEAD for context.** Always pins to `comment.commit_id` so the proposed fix matches what the reviewer actually saw.
- **Never silently guesses when uncertain.** Low or no confidence must be surfaced, not hidden behind a plausible-looking diff.
- **Responds to the webhook fast.** All slow work (file fetch, Gemini call, DB write) happens after the HTTP 200 ack, not before — GitHub times out slow deliveries.

---

### Tools available to the agent

| Tool | Purpose | Read or write |
|---|---|---|
| GitHub Contents API | Fetch file content at a specific commit | Read |
| GitHub Pulls/Comments API | Fetch PR and comment metadata | Read |
| Gemini API | Generate structured fix from comment + code context | N/A (generation) |
| MongoDB | Store/check Suggestion records for dedup and review queue | Read/Write (internal state only) |
| GitHub Contents API (commit) | Apply approved fix to the PR branch | Write — only from the approve action |
| GitHub Comments API (reply) | Post confirmation reply on the original thread | Write — only from the approve action |

The agent itself only ever exercises the **read** tools and Gemini autonomously. The two **write** tools are gated behind a human-triggered approval action and are never called from the webhook pipeline directly.

---

### Failure handling

- Gemini call fails or returns invalid JSON → save Suggestion with `status: "failed"`, surface in dashboard for manual inspection, do not retry automatically.
- File fetch fails (e.g. file deleted since the comment) → same as above, `status: "failed"`.
- Approve action fails mid-commit (e.g. stale SHA) → do not mark as applied; surface the error to the user, allow re-approval after refetching current state.

---

### Out of scope (explicitly not handled by this agent)

- Comments that require multi-file changes
- Comments expressing disagreement with overall design/architecture
- Auto-merging or auto-approving the PR itself
- Resolving comment threads without a corresponding committed fix
- Any write action triggered without a human approval click
