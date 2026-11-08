# NEXUS AU — Agent System

## Goal

Agents are specialized task workers coordinated by a bounded orchestrator. They are not independent authorities and do not bypass user permissions.

## Initial agent roles

- **Main / Coordinator:** interprets the user request, delegates bounded subtasks, and combines results.
- **Research:** gathers and summarizes source-grounded information.
- **Coding:** inspects, edits, and tests code within an explicitly authorized workspace.
- **Analyst:** evaluates data and documents.
- **Writer:** drafts structured text and documentation.
- **Planner:** converts goals into ordered tasks and acceptance criteria.
- **Memory:** proposes memory updates and retrieves approved records.
- **Browser:** interacts with explicitly permitted web resources.
- **Security Reviewer:** checks proposed changes, permissions, and risky tool use.

These are proposed roles, not claims that agents have already been implemented.

## Agent contract

Each agent definition should include:

- Stable identifier and display name.
- Purpose and system instructions.
- Model/provider configuration.
- Allowed tools and capabilities.
- Input and output schemas.
- Timeout and step budget.
- Maximum delegation depth.
- Cancellation behavior.
- Logging and audit metadata.

## Orchestration lifecycle

1. Validate the user's request.
2. Create a task with explicit scope and acceptance criteria.
3. Select the minimum necessary agents.
4. Provide only relevant context and approved tools.
5. Execute within time, step, and budget limits.
6. Validate outputs and collect evidence.
7. Request user approval before sensitive actions.
8. Return a concise result and execution summary.

## Safety constraints

- No unbounded agent loops or recursive delegation.
- No permission escalation without user approval.
- No secrets in prompts or logs unless strictly required by a secure provider flow.
- Treat retrieved documents and tool output as untrusted input.
- Make cancellation available.
- Keep a trace of agent decisions and tool calls.


## Implemented runtime slice

The first provider-neutral runtime primitive is implemented in `src/core/agents.ts` with deterministic tests in `src/core/agents.test.ts`.

Currently implemented: agent registration, metadata listing, preflight permission checks, explicit approval handoff event, cancellation, timeout signal, checkpoint/step limits, and output-size limits. An explicit checkpoint followed by a progress event with the same label counts as one logical step.

Not implemented yet: approval resume, model-backed planning, tool gateway integration, specialist delegation, token budgets, persistent run history, and UI. The role list above remains a design proposal, not a set of working agents.


## Agent checkpoint foundation

Implemented in `src/core/agentCheckpoints.ts` and `src/lib/agentCheckpointStorage.ts`:
- Versioned run snapshots with thread/agent/run identity.
- Monotonic sequence numbers and compare-and-swap stale-writer protection.
- Immutable run identity and creation timestamp; terminal snapshots cannot be overwritten.
- JSON-only state payload capped at 256 KB and approval metadata validation.

This is a persistence contract and LocalStorage preview adapter. It is **not yet connected to AgentRuntime**, does not resume an interrupted iterator, and does not provide crash-safe SQLite durability. Those require a serializable agent state machine and explicit resume semantics; replaying arbitrary generator code would be unsafe and incorrect.


## Serializable step runtime

Implemented in `src/core/resumableAgents.ts` with tests in `src/core/resumableAgents.test.ts`.
- Agent work is expressed as a deterministic state transition: JSON state in, one bounded step out.
- Each step's next state is persisted before progress/output events are emitted.
- A running checkpoint can be claimed with compare-and-swap and continued by a fresh runtime instance after restart.
- Approval pauses persist the requested permission; resume requires the exact pending permission and consumes the waiting state before execution.
- The runtime applies a step budget, per-execution timeout, output/progress bounds, and fails closed on permission-service errors.

Important limits: this is a core runtime contract, not yet wired to the UI, Tool Gateway, SQLite, or native secure storage. The current checkpoint adapter is browser LocalStorage preview storage. A crash after a step's external side effect but before its checkpoint is committed can still cause that step to be retried; side-effecting steps must remain idempotent until operation-level idempotency and durable transactions are implemented. Agent definitions must be re-registered after restart.