# Changelog

All notable NEXUS AU changes are recorded here. This project is under active development; entries describe implemented slices, not a claim that the full roadmap is complete.

## Unreleased

### Added
- Provider-neutral core contracts for conversations, model streaming, memory, bounded agents, and tool execution.
- User-confirmed memory records with provenance and deterministic local lexical retrieval.
- Bounded agent runtime with permission checks, cancellation, timeout, step budgets, and output limits.
- Permission-enforcing Tool Gateway with input/output limits and audit lifecycle port.
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
- Agent checkpoints are not yet wired into AgentRuntime; async-generator runs cannot currently resume after restart.
- LocalStorage adapters are preview-only and are not encrypted production storage.
- SQLite migrations, OS credential vault, MCP, voice, native desktop verification, and hosted proxy remain pending.
- Dependency installation currently reports six npm audit advisories; each requires triage before upgrades.
