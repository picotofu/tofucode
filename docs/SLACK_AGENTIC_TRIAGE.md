# Slack Agentic Triage

## Requirements

- Replace the current blind two-pass classifier (haiku → sonnet refinement) with an agentic triage pipeline that can actively investigate before classifying
- Give the classifier access to read-only filesystem tools so it can grep routes, read files, and resolve ambiguity itself rather than guessing
- Triage latency is not a concern — the bot should take its time and get it right
- Project mapping for `work` actions must be verified from actual code, not pattern-matched from folder names
- `answer` quality should improve when the question requires domain context (e.g. "which endpoint handles X?", "what does field Y mean?")
- Architecture must remain isolated — no changes to web UI, dispatchAction, or downstream consumers

## Context

- Current classifier: `allowedTools: []` — no tools, pure text classification
- Current escalation: haiku (1 turn, blind) → sonnet (1 turn, blind refinement prompt)
- System prompt is rich — identity, role, domain, project list, Notion field mappings — but classifier can't act on it
- `projectRootPath` = `/home/ts/projects` — all service repos live here
- Known services: `anime-service`, `user-service`, `social-service`, `content-service`, `recommendation-service`, `dashboard/admin-panel-revamp`, `dashboard/admin-service`, `pg-migration-pipeline`
- Route → service mapping is not hardcoded anywhere — must be inferred from file content
- API path format: `/api/{context}/v1/{route}` where context = first segment of repo name
- Agent SDK `query()` supports `allowedTools` array and `maxTurns` cap — already used in executor.js
- `permissionMode: 'bypassPermissions'` is global default — classifier should use a more restrictive mode
- Classification output schema is fixed — consumers (`dispatchAction`) must not change

## Scope

- Modify `classifier.js` only — no changes to event handlers, shared.js, or dispatchAction
- New Tier 2: Sonnet with read-only tools (`Grep`, `Glob`, `Read`, `Bash` restricted to safe read commands) running against `projectRootPath` as cwd
- Tool loop capped at configurable max turns (default 5) to prevent runaway loops
- Haiku Tier 1 stays unchanged — fast cheap filter for the obvious 80%
- Escalation trigger: same as now (`low confidence` or `needsContext`) — but escalation now means "investigate then classify" not "guess harder"
- Post `:thinking_face:` reaction immediately on escalation so user sees activity (requires passing slackApi + event into classifyMessage — currently not passed)
- Session logging: tool turns are part of the same JSONL session, visible in tofucode UI

## Plan

### Phase 1 — Pass slackApi + event into classifyMessage

Currently `classifyMessage` receives: `{ message, threadHistory, channelInfo, senderName, resolveName, config }`

Need to add `slackApi` and `event` (for reaction posting) — update call sites in `message.js` and `dm.js`.

### Phase 2 — Post thinking reaction on escalation

As soon as `shouldEscalateToSonnet(initial)` is true, post `:mag:` reaction to the original message before the tool loop starts. Gives user immediate visual feedback.

### Phase 3 — Agentic Tier 2 (Sonnet + tools)

Replace `runClassification('sonnet', ..., escalationPrompt, ..., haikuSessionId)` with a new `runAgenticClassification()` function that:

- Uses agent SDK `query()` with `allowedTools: ['Grep', 'Glob', 'Read']`
- Sets `cwd: projectRootPath` so tools operate on the codebase
- Sets `permissionMode: 'default'` (not bypass — read only is fine)
- Sets `maxTurns: 5` (configurable via `config.classifier.maxTriageTurns`)
- Resumes the haiku session (same JSONL) for continuity
- Prompt: instructs Sonnet to investigate using tools, then return classification JSON

### Phase 4 — Prompt engineering for agentic pass

The escalation prompt must clearly instruct the model on:
- What tools are available and what they're for
- The investigation strategy (grep route → find service → confirm → classify)
- That the final output must still be the classification JSON schema
- Budget awareness — don't over-investigate simple cases

### Phase 5 — Config extension

Add `classifier.maxTriageTurns` to `DEFAULT_CONFIG` (default: 5), surfaced in Settings modal under the classifier section.

### Open Questions

1. Should `Bash` be in the allowed tools? `Grep` and `Glob` cover most needs without exec risk. `Read` covers file content. Bash adds power but also risk.
2. Should the reaction be posted before haiku (as a "processing" signal) or only on escalation? Currently only on escalation makes more sense — most messages resolve in haiku.
3. If the agentic pass still returns low confidence after tool loop, should we fall back to ticket or ask for clarification?
