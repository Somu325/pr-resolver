Build a PR Comment Resolver Agent — a full-stack application (React + Node/Express + MongoDB) that automatically detects GitHub pull request review comments, generates a targeted code fix using the Gemini API, and pushes the fix to the PR branch after human approval.

CORE BEHAVIOR (what makes this an agent, not just a tool):
The trigger must be a GitHub webhook (pull_request_review_comment, action=created), not a button click. The moment someone posts a review comment on a PR, the server should automatically: fetch the exact file content at the comment's commit_id, send the comment plus surrounding code context to Gemini, and store a structured fix suggestion in the database with status "pending" — all without any user interaction. The only manual step in the entire flow is a human clicking Approve or Reject on a dashboard. Approving commits the fix directly to the PR's existing branch and posts a reply to the original review comment thread. Rejecting just marks it rejected. Never auto-commit without explicit approval.

AUTH:
Use GitHub OAuth (not a personal access token) so the app works for any logged-in GitHub user, not just one developer. Standard flow: redirect to GitHub's authorize endpoint with client_id and scope=repo, GitHub redirects back to a callback route with a code, exchange that code server-side for an access_token, then use that token for all subsequent GitHub API calls made on behalf of that user. Store the token securely server-side (eventually httpOnly cookie + session; plaintext in DB is acceptable for local dev only, never for anything deployed).

FIX GENERATION MUST BE STRUCTURED, NOT FREE TEXT:
Don't let Gemini return a paragraph suggestion — that can't be programmatically applied to a file. Use Gemini's responseSchema / structured output mode to force a JSON response shaped like { startLine, endLine, newCode, explanation }. Send Gemini only a context window of lines around the comment (e.g. ±15 lines), not the whole file, with line numbers included in the prompt so it can return an accurate line range. The fix must be scoped and minimal — only the lines relevant to the comment, never a full-file rewrite.

DATA MODEL:
A Suggestion document per processed comment: owner, repo, prNumber, commentId (unique — prevents reprocessing on duplicate webhook deliveries), commentBody, filePath, prHeadBranch, startLine, endLine, suggestedCode, explanation, status (pending | approved | rejected | applied), timestamps. commentId must be unique in the DB so re-delivered webhooks (GitHub retries on failure) don't create duplicate suggestions or trigger duplicate Gemini calls.

REQUIRED BACKEND ROUTES:
- GET /auth/github and GET /auth/callback — OAuth login flow
- GET /repos and GET /repos/:owner/:repo/pulls — list the logged-in user's repos and a repo's open PRs, used for a manual fallback view and for letting the user register webhooks per repo
- GET /file-content — fetch raw file content from GitHub at a specific commit SHA (not branch HEAD — use the comment's own commit_id for precision)
- POST /generate-fix — internal helper that builds the context window, calls Gemini with responseSchema, returns structured fix JSON
- POST /webhook — receives GitHub events; must respond 200 immediately before doing any slow work (file fetch / Gemini call), since GitHub times out and retries slow webhook deliveries; filters to pull_request_review_comment + action=created; skips if commentId already exists in DB; otherwise runs the fetch-file → generate-fix → save-suggestion pipeline
- GET /suggestions?status=pending — dashboard queue, decoupled from any specific repo/PR selection, shows everything pending across all the user's repos
- POST /suggestions/:id/approve — fetches current file SHA, splices suggestedCode into the file at startLine–endLine, commits via GitHub's contents API to prHeadBranch, replies to the original review comment, marks suggestion as applied
- POST /suggestions/:id/reject — marks suggestion as rejected, no GitHub side effects

REQUIRED FRONTEND (React):
A login-with-GitHub button/state. A dashboard that lists pending suggestions as cards (repo, PR, file, original comment text, before/after diff of the proposed fix, explanation, Approve/Reject buttons) — this is the primary view once webhooks are working. Keep the existing manual repo→PR→comments dropdown flow as a secondary/fallback view for testing without waiting on a real webhook event.

LOCAL DEV NOTE:
GitHub webhooks need a public URL; localhost won't work. Use ngrok (or similar tunnel) to expose the local Express server during development, and register that tunnel URL as the webhook payload URL on the test repo, pointed at /webhook.

NON-GOALS for the first working version (explicitly skip until the core loop works end to end):
auto-registering webhooks via API, encrypting tokens at rest, rate limiting, batching multiple comments into one commit, full-file rewrites, multi-file fixes, or any deployment beyond local dev with ngrok.

DEFINITION OF DONE:
Posting a real review comment on a GitHub PR — with zero clicks from the developer — results in a new "pending" suggestion appearing in the dashboard within a few seconds, showing an accurate, minimally-scoped code fix. Clicking Approve results in a real commit on the PR's branch on GitHub and a real reply under the original comment thread, with no manual git/GitHub interaction required.
