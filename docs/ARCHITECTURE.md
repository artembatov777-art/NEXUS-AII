# NEXUS AU — System Architecture

## High-level structure

NEXUS AU is divided into a desktop presentation layer, a native application layer, and modular domain services.

```text
React + TypeScript UI
        |
        | Tauri commands / events
        v
Tauri 2 + Rust application layer
        |
        +-- AI provider adapters
        +-- Conversation and project services
        +-- Memory service
        +-- Agent orchestration
        +-- Tool permission broker
        +-- Voice service
        +-- Local persistence (SQLite)
        |
        v
External providers and explicitly enabled tools
(OmniRoute-compatible endpoint, MCP servers, APIs)
```

## Technology choices

- Frontend: React, TypeScript, Vite.
- Desktop shell: Tauri 2.
- Native layer: Rust.
- Persistence: SQLite, introduced behind a repository/data-access layer.
- AI routing: provider adapter compatible with the configured OmniRoute API.
- Tool integrations: MCP and narrowly scoped application adapters.
- Quality: unit tests, integration tests, formatting, linting, and CI.

## Architectural boundaries

### Frontend

Responsible for presentation, navigation, user input, and rendering application state. It must not contain provider secrets or directly execute privileged operating-system operations.

### Rust application layer

Owns privileged operations, local persistence, credential access, permission checks, and communication with configured providers and tools. Tauri commands should expose narrow, typed operations rather than generic unrestricted shell access.

### AI provider adapter

Normalizes provider configuration, request construction, streaming events, errors, and model metadata. Base URLs and authentication formats must be configurable and verified against the selected provider. Do not assume an endpoint that has not been tested.

### Memory service

Separates memory records by scope (profile, conversation, project, knowledge, task). It must support inspection, correction, and deletion by the user. Retrieval should return source/context metadata where possible.

### Agent orchestration

Runs bounded tasks with explicit budgets, timeouts, step limits, and tool permissions. Agents receive only the context and tools required for their task. The orchestrator records task state and results.

### Tool permission broker

All external or privileged tools go through a central permission layer. Each tool declares capabilities and risk level. Destructive, external, or irreversible actions require confirmation.

## Suggested package boundaries

- `core`: shared domain types and application contracts.
- `ai-router`: provider interfaces and adapters.
- `memory`: memory domain and retrieval.
- `agents`: agent definitions and orchestration.
- `tools`: tool registry and permission broker.
- `database`: SQLite schema and repositories.
- `voice`: speech interfaces and provider adapters.
- `shared`: validated shared types and utilities.

These are target boundaries. Create packages when implementation begins; do not add empty packages merely to imitate the target structure.

## Data flow

1. The UI submits a typed request.
2. The Rust layer validates the request and user configuration.
3. The provider adapter sends the request to the configured endpoint.
4. Streaming or final results are returned through typed events.
5. Conversation state is persisted locally.
6. Memory extraction, if enabled, is a separate user-configurable operation.

## Reliability

- Validate all inputs at system boundaries.
- Use typed errors and actionable UI messages.
- Add timeouts and cancellation for network and agent tasks.
- Avoid blocking the UI thread.
- Log operational metadata without logging secrets or unnecessary private content.
- Keep database migrations versioned.
