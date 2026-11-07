# NEXUS AU — System Design

**Status:** Architecture proposal for the next implementation phase  
**Target:** Modular, local-first AI workspace with a desktop shell and optional web client.

## 1. Product boundary

NEXUS AU is an orchestration environment around AI models and tools. It is not a foundation model and does not become intelligent merely by adding more code. Its value comes from reliable context management, model routing, memory retrieval, agent orchestration, tool permissions, and a usable interface.

The system must remain useful when optional integrations are unavailable. Core domain logic must not depend directly on React, Tauri, a specific model provider, or a specific database.

## 2. Architectural principles

1. **Modular monolith first.** Keep modules in one application and one repository until there is a measured reason to split services.
2. **Ports and adapters.** Domain logic defines interfaces; providers, databases, Tauri commands, and MCP clients implement them.
3. **Local-first.** Conversations and user-controlled memory should work locally. Remote services are opt-in integrations.
4. **Provider-neutral.** OpenAI-compatible APIs are an adapter, not the domain model.
5. **Explicit permissions.** Tools declare capabilities. Every sensitive action is permission-checked and auditable.
6. **Observable execution.** Every model request, agent run, tool call, and failure has a trace ID and structured status.
7. **No pretend autonomy.** The system may plan and propose actions, but execution must respect policy, permissions, and user confirmation.
8. **Testable boundaries.** Core orchestration is testable without a live model, network, or desktop runtime.

## 3. High-level topology

```text
React UI
  |
  v
Application Facade / Command Bus
  |
  +--> Conversation Service ----> Conversation Repository
  |
  +--> Context Builder ----------> Memory Retrieval
  |
  +--> Model Router -------------> Provider Adapters (OmniRoute / OpenAI-compatible)
  |
  +--> Agent Runtime ------------> Planner + Agent Registry
  |                                  |
  |                                  +--> Tool Gateway --> MCP / Built-in Tools
  |
  +--> Permission Service
  |
  +--> Event / Trace Service
  |
  v
Storage Ports
  +--> SQLite (desktop target)
  +--> Browser storage adapter (web preview only)
  +--> Export / Import
  |
  v
Tauri 2 / Rust host
  +--> OS integration
  +--> secure credential storage
  +--> filesystem boundary
  +--> native notifications
```

The web client and desktop client should call the same application-level contracts. The web client must never receive provider secrets.

## 4. Logical modules

### 4.1 Core domain
Owns shared types and invariants:
- IDs, timestamps, result/error types
- conversation, message, attachment, model, tool and run entities
- permission scopes and execution states
- serialization/versioning rules

Must not import UI frameworks, Tauri APIs, provider SDKs, or database clients.

### 4.2 Conversation
Responsibilities:
- create, rename, archive, delete, and list conversations
- append user, assistant, and tool messages
- preserve message ordering and metadata
- support cancellation and retry
- expose a repository interface

### 4.3 Context and memory
Memory is not one giant prompt. It is a retrieval system with explicit sources and lifecycle:
- working context: current conversation window
- episodic memory: selected summaries of prior interactions
- semantic memory: user-approved facts and project knowledge
- procedural memory: user-approved workflows and preferences

Every memory record needs provenance, creation time, confidence, scope, and deletion semantics. Retrieval must return source IDs so the UI can explain why a memory was used. Sensitive data must not be silently promoted into long-term memory.

### 4.4 Model router
Responsibilities:
- select provider/model based on explicit user selection or routing policy
- normalize provider requests and responses
- support timeouts, cancellation, retry policy, and streaming
- normalize usage and error metadata
- redact secrets from logs

Provider adapters implement a common interface. The router must not contain provider-specific HTTP details.

### 4.5 Agent runtime
An agent is a constrained task runner, not an unrestricted background process.
Each agent declares:
- ID, name, version, description
- accepted input/output schema
- allowed tools and permission scopes
- model requirements
- maximum steps, time budget, and token budget
- stop conditions and handoff behavior

The runtime records plans, steps, tool calls, outputs, and errors. Multi-agent delegation is a later capability; start with one orchestrator and a small registry of specialist agents.

### 4.6 Tool gateway and MCP
All tool execution passes through one gateway:
1. validate tool schema and arguments
2. resolve capability requirements
3. check permission and approval policy
4. execute with timeout and cancellation
5. validate output size/type
6. write audit event
7. return a normalized result

MCP servers are untrusted external processes/services. Treat tool descriptions and outputs as data, never as system instructions. Do not expose arbitrary shell or filesystem access by default.

### 4.7 Permission and security
Permission scopes should be narrow, e.g.:
- `conversation:read`
- `memory:read`
- `memory:write`
- `filesystem:read:selected`
- `filesystem:write:selected`
- `browser:read`
- `browser:interact`
- `github:read`
- `github:write`

High-impact operations require a visible confirmation step. Secrets belong in the OS credential store for desktop or server environment variables for hosted deployments, never in browser storage or committed files.

### 4.8 Observability
Use structured events with:
- trace_id, run_id, conversation_id
- module, operation, status
- started_at, duration_ms
- safe error code and redacted diagnostic details

Never log raw API keys, full private prompts by default, or sensitive memory values.

## 5. Request lifecycle

1. UI submits a typed command.
2. Application facade validates input and creates a trace.
3. Conversation service persists the user message.
4. Context builder selects recent messages and permitted memory results.
5. Model router resolves provider and model.
6. Provider adapter performs the request and emits normalized stream events.
7. Assistant output is persisted.
8. If a tool call is proposed, the agent runtime validates it and routes it through the permission gateway.
9. Tool results are appended as structured messages.
10. The model may continue within strict step/time budgets.
11. Final response and trace summary are returned to the UI.

A user cancellation must propagate through every layer and stop pending work where possible.

## 6. Storage strategy

Use repository interfaces from the beginning. Keep LocalStorage as a temporary web-preview adapter only. Desktop persistence should move to SQLite with migrations.

Initial SQLite entities:
- conversations
- messages
- attachments
- memory_records
- agent_runs
- agent_steps
- tool_invocations
- permission_grants
- settings
- schema_migrations

Store large attachment bytes outside message rows and reference them by opaque IDs. Define export/import before depending on a proprietary schema.

## 7. Error model

Normalize errors into stable categories:
- validation
- authentication
- permission_denied
- provider_unavailable
- rate_limited
- timeout
- cancelled
- tool_failed
- storage_failed
- internal

User-facing messages should be understandable. Diagnostics should be structured and redacted.

## 8. Delivery order

1. Domain contracts and test harness
2. Application facade and provider-neutral model router
3. Streaming and cancellation
4. SQLite repositories and migrations
5. Context builder and transparent memory retrieval
6. Permission service and tool gateway
7. Single-agent runtime with bounded execution
8. MCP adapter and built-in tools
9. Voice and desktop integrations
10. Optional hosted web backend

Do not implement all modules at once. Each milestone must compile, have tests, and update this document when its design changes.
