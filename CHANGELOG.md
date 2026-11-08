# Changelog

All notable NEXUS AU changes are recorded here. This project is under active development; entries describe implemented slices, not a claim that the full roadmap is complete.

## Unreleased

### Added
- Agent Control Center integrated into the workspace with a bounded local demo agent, explicit approval/rejection, run progress, cancellation, checkpoint history, and resume support.
- Resumable agent registry exposes metadata-only descriptors, and the Control Center displays registered agent limits plus checkpointed final preview output.
- Editable local agent profile with validated execution budgets, local persistence, and versioned runtime replacement; active/waiting runs block profile changes.
- Built-in local workflow agent invokes a non-destructive preview tool only through the Tool Gateway; its UI explicitly states that no LLM or external system is involved.
- Integration tests covering built-in agent approval, gateway invocation, audit events, persisted completion, and invalid input.
- Provider-neutral core contracts for conversations, model streaming, memory, bounded agents, and tool execution.
- User-confirmed memory records with provenance and deterministic local lexical retrieval.
- Bounded agent runtime with permission checks, cancellation, timeout, step budgets, and output limits.
- Permission-enforcing Tool Gateway with input/output limits and audit lifecycle port.
- LocalStorage preview audit sink with bounded append/list operations and stored-record validation.
- Explicit non-retryable error when a tool side effect completes but its completion audit cannot be persisted.
- Host-identity-bound bridge that lets resumable agent steps invoke tools only through the permission-enforcing Tool Gateway, covered by an integration test.
- Browser-preview composition root that wires checkpoint storage, audit storage, permission adapters, the Tool Gateway, agent bridge, one-time approval authority, and resumable runtime.
- End-to-end composition tests covering approval handoff, one-time grant consumption, host identity, tool permission checks, audit lifecycle, and checkpoint completion.
- Ephemeral one-time agent approval grants bound to run, agent, and exact permission; forged and replayed grants fail closed.
- Versioned agent checkpoint contract, compare-and-swap sequence protection, and LocalStorage preview adapter.
- Initial upstream research and architecture decisions for LangGraph.js, Mem0, LlamaIndex, OpenHands, and awesome-llm-apps.
- Initial threat model and capability permission matrix.

### Changed
- Memory search now weights rare terms and tag matches more strongly than common terms.
- Agent progress events and explicit checkpoints count one logical step when they share the same label.

### Security
- Checkpoint state is restricted to bounded, safe JSON data.
- Invalid stored checkpoint records and stale writes are rejected.
- No provider credentials, shell access, or unrestricted host capabilities were added.

### Known limitations
- The built-in workflow agent is a deterministic demonstration, not a model-powered planner. The UI event feed is session-only; checkpoints persist in localStorage, but approval grants are ephemeral. Reopening the app requires fresh approval for waiting runs.
- Browser preview checkpoint and audit storage remain tamperable and non-transactional; native secure persistence and idempotency are required before sensitive tools are enabled.
- The resumable step-based runtime is wired into the Agent Control Center in browser preview. Approval grants are in-memory and require re-approval after restart.
- LocalStorage adapters, including memory, checkpoints, and audit, are preview-only and are not encrypted or tamper-proof production storage. The audit adapter also lacks atomic multi-tab writes.
- SQLite migrations, OS credential vault, MCP, voice, native desktop verification, and hosted proxy remain pending.
- Dependency installation currently reports six npm audit advisories; each requires triage before upgrades.
