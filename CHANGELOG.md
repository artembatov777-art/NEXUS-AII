# Changelog

All notable NEXUS AU changes are recorded here. This project is under active development; entries describe implemented slices, not a claim that the full roadmap is complete.

## Unreleased

### Added
- Provider-neutral core contracts for conversations, model streaming, memory, bounded agents, and tool execution.
- User-confirmed memory records with provenance and deterministic local lexical retrieval.
- Bounded agent runtime with permission checks, cancellation, timeout, step budgets, and output limits.
- Permission-enforcing Tool Gateway with input/output limits and audit lifecycle port.\n- LocalStorage preview audit sink with bounded append/list operations and stored-record validation.\n- Explicit non-retryable error when a tool side effect completes but its completion audit cannot be persisted.
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
- The resumable step-based agent runtime has resume entry points, but it is not yet wired into the application UI or Tool Gateway.
- LocalStorage adapters, including memory, checkpoints, and audit, are preview-only and are not encrypted or tamper-proof production storage. The audit adapter also lacks atomic multi-tab writes.
- SQLite migrations, OS credential vault, MCP, voice, native desktop verification, and hosted proxy remain pending.
- Dependency installation currently reports six npm audit advisories; each requires triage before upgrades.
