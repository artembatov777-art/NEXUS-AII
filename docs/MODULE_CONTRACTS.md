# NEXUS AU — Module Contracts

This document defines the first stable boundaries between modules. It is intentionally implementation-oriented but does not bind the project to one database or AI provider.

## 1. Dependency rules

Allowed dependency direction:

```text
UI -> Application -> Domain
Infrastructure -> Domain interfaces
Tauri host -> Application facade + Infrastructure
```

Forbidden:
- Domain importing React, Tauri, HTTP clients, SQLite, or provider SDKs.
- UI calling provider endpoints directly with secrets.
- Agents bypassing the Tool Gateway.
- Tools invoking other tools without runtime policy checks.
- Storage implementations leaking database-specific records into domain types.

## 2. Shared result types

Use discriminated unions rather than throwing arbitrary strings across module boundaries.

```ts
export type AppErrorCode =
  | "validation"
  | "authentication"
  | "permission_denied"
  | "provider_unavailable"
  | "rate_limited"
  | "timeout"
  | "cancelled"
  | "tool_failed"
  | "storage_failed"
  | "internal";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export interface AppError {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  traceId?: string;
}
```

Errors must not contain credentials or raw secret-bearing headers.

## 3. Model provider port

```ts
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "completed"; finishReason?: string };

export interface ModelProvider {
  readonly id: string;
  listModels(): Promise<Result<ModelDescriptor[]>>;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}
```

Provider adapters normalize vendor-specific payloads. The application layer must not know the provider's HTTP response shape.

## 4. Repository ports

```ts
export interface ConversationRepository {
  list(): Promise<Result<ConversationSummary[]>>;
  get(id: string): Promise<Result<Conversation | null>>;
  save(conversation: Conversation): Promise<Result<void>>;
  delete(id: string): Promise<Result<void>>;
}

export type MemoryScope = "all" | "profile" | "project" | "conversation";

export interface MemoryRecord {
  id: string;
  content: string;
  category: "preference" | "goal" | "fact" | "workflow" | "project";
  scope: Exclude<MemoryScope, "all">;
  source: {
    type: "user_confirmed" | "conversation" | "import";
    referenceId?: string;
    label: string;
  };
  tags: string[];
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface MemoryRepository {
  search(query: string, scope: MemoryScope, limit: number): Promise<Result<MemoryRecord[]>>;
  save(record: MemoryRecord): Promise<Result<void>>;
  delete(id: string): Promise<Result<void>>;
}
```

Implementations may be LocalStorage (temporary preview) or SQLite (desktop). The domain-facing contract remains stable.

## 5. Permission port

```ts
export type PermissionScope =
  | "conversation:read"
  | "memory:read"
  | "memory:write"
  | "filesystem:read:selected"
  | "filesystem:write:selected"
  | "browser:read"
  | "browser:interact"
  | "github:read"
  | "github:write";

export interface PermissionRequest {
  actorId: string;
  scope: PermissionScope;
  resource?: string;
  reason: string;
  risk: "low" | "medium" | "high";
}

export interface PermissionService {
  authorize(request: PermissionRequest): Promise<"allow" | "deny" | "ask_user">;
}
```

Default-deny is required for filesystem writes, browser interaction, GitHub writes, shell execution, and other externally visible actions.

## 6. Tool contract

```ts
export interface ToolDefinition<Input = unknown, Output = unknown> {
  id: string;
  version: string;
  description: string;
  inputSchema: unknown;
  requiredPermissions: PermissionScope[];
  risk: "low" | "medium" | "high";
  execute(input: Input, context: ToolExecutionContext): Promise<Result<Output>>;
}

export interface ToolExecutionContext {
  traceId: string;
  runId: string;
  signal: AbortSignal;
}
```

Tool inputs and outputs must be size-limited and schema-validated. Tool descriptions and results are untrusted data.

## 7. Agent contract

```ts
export interface AgentDefinition<Input = unknown, Output = unknown> {
  id: string;
  version: string;
  description: string;
  allowedTools: string[];
  maxSteps: number;
  timeoutMs: number;
  run(input: Input, context: AgentContext): Promise<Result<Output>>;
}
```

AgentContext exposes only approved application services and the Tool Gateway. It must not expose unrestricted network, shell, or filesystem APIs.

## 8. Event contract

All long-running operations emit lifecycle events:
- operation.started
- operation.progress
- operation.waiting_for_approval
- operation.completed
- operation.failed
- operation.cancelled

Events include traceId and runId where applicable. UI rendering must be driven by these events, not by polling arbitrary internal state.

## 9. Versioning

- Public module contracts are versioned.
- Persisted records include schemaVersion.
- Breaking changes require a migration and a note in CHANGELOG.
- Prefer additive changes; avoid renaming serialized fields casually.


## 10. Bounded agent runtime

The first runtime implementation lives in `src/core/agents.ts`. It is provider-neutral and does not import UI, Tauri, model SDKs, or infrastructure adapters.

```ts
export interface AgentDefinition<Input = unknown> {
  id: AgentId;
  version: string;
  name: string;
  description: string;
  requiredPermissions: AgentPermission[];
  maxSteps: number;
  timeoutMs: number;
  execute(input: Input, context: AgentContext): AsyncIterable<AgentOutputEvent>;
}

export interface AgentContext {
  runId: AgentRunId;
  signal: AbortSignal;
  checkpoint(label: string): void;
}
```

Runtime guarantees and current limits:
- Registration validates identity, version, step budget (1–100), and timeout (1–600 seconds).
- Required permissions are checked before agent execution; errors fail closed.
- `ask_user` emits a waiting-for-approval event and stops. Resuming an approval is not implemented yet.
- Execution has cancellation, a timeout signal, a bounded step/checkpoint budget, and a 20,000-character per-output limit.
- Agents receive no direct filesystem, shell, browser, or network APIs.
- This is a single-agent execution primitive, not yet a planner, multi-agent orchestrator, or tool gateway.
- Agent code must call `context.checkpoint(label)` before each meaningful unit of work. The runtime also counts progress events as steps.

Future tool execution must go through a separate permission-enforcing Tool Gateway. Never pass raw host capabilities into an agent.


## 11. Tool Gateway

The first gateway implementation lives in `src/core/tools.ts`.

- Tool definitions declare required permission scopes, risk, timeout, input validation, and execution.
- Inputs and outputs must be JSON-serializable and no larger than 64 KB.
- Permission checks run before execution. `deny`, `ask_user`, and permission-service errors all fail closed.
- An audit `started` event must persist before the tool is allowed to execute.
- Execution receives an abort signal and is bounded by a per-tool timeout.
- Tools are discoverable through metadata only; implementation functions are not exposed.
- The gateway is not yet connected to agents, MCP, UI approval flows, or a persistent audit store. The current audit sink is an injected port.
