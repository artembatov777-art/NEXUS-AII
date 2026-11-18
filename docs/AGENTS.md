# NEXUS AU — Agent Runtime

## Product contract

Agents are bounded task workers. They do not bypass the Tool Gateway, owner-approved workspace roots, provider credential vault, or explicit permission policy. Retrieved documents and MCP output are untrusted data, never instructions that can grant permissions.

## Implemented runtime

- `src/core/resumableAgents.ts` implements a serializable step runtime with bounded steps, execution time, progress/output size, cancellation, and version-pinned agent definitions.
- Each state transition is persisted before its progress/output event is emitted. The desktop composition root uses the native SQLite checkpoint repository; browser preview uses localStorage and is not a security boundary.
- Approval pauses store the requested permission. The host issues an opaque, one-time grant bound to the run, agent, and permission. Outstanding in-memory grants are intentionally invalidated by restart, so a pending action must be reviewed again.
- `src/core/toolInvocationAgent.ts` adapts model-planned tool calls to the Tool Gateway. `src/lib/workspaceTools.ts` registers bounded list, search, content-search, read, write, mkdir, rename, and move operations. Native Rust filesystem commands remain the final access-control boundary.
- `src/components/AgentControlCenter.tsx` exposes the local preview workflow, model-backed planning, task execution, checkpoint controls, ambiguous-outcome reconciliation, and recent audit events.
- `src/core/multiAgentCoordinator.ts` executes validated, dependency-ordered plans with a bounded number of delegated steps. The current model-planned workflow assigns those steps to the Tool Invocation Agent; a full specialist-agent team is not yet a release claim.
- The coordinator deep-copies the validated JSON plan before yielding or pausing for approval, so caller mutation cannot change a previously reviewed nested tool input.
- MCP servers can be configured over HTTPS or loopback HTTP, discovered, and imported into the Tool Registry. Every imported call requires a separate owner confirmation. The current UI supports unauthenticated MCP endpoints only; OAuth and bearer-token credential flows are not implemented.

## Built-in workflows

1. **Local workflow demo:** creates a local, non-destructive task preview. It does not call a model or access external systems.
2. **Model-planned workflow:** uses the selected provider to produce a bounded plan, validates tool IDs and schemas against the live registry, and executes approved operations through the Tool Gateway. Local no-key profiles are supported when explicitly configured as credential-free.

## CLI workspace planner

`cli/workspacePlanner.ts` turns a structured user task into bounded local
discovery through the shared `AgentPlanner`, `PlanExecutor` and
`GatewayAgentToolExecutor`. It prepares exact replacements from protected
snapshots using the same function as `/draft`. It hashes the plan with the
selected root, goal, plan ID, candidates, and proposed actions with their
source revisions and content hashes. The planner uses a local, read-only tool
catalog. All project reads and writes go through the Rust workspace process
over stdio.

`cli/workspaceHost.ts` presents the plan, gates approval on previewing the
agent diff and passes only the reviewed plan to the existing apply tool.
Approval is session-local, expires after five minutes and is consumed by one
attempt. Apply checks every source revision before dispatching writes.
The native process checks each source again under its directory lock.
One file can succeed before another fails or the host loses its reply.

`cli/workspaceRecovery.ts` stores original text separately from audit metadata.
The version 4 intent and step journal record paths, revisions, hashes and
outcomes. Checksums bind the private plaintext recovery payload,
intent and write receipts to the operation and detect corruption. Only
confirmed, unchanged results are eligible for rollback, which requires its
own preview and approval. `/recover` observes the current state even if the
backups are unavailable, provided the audit intent is intact. Existing
journals are retained. Linux is the only supported write platform.

### Desktop offline planner

The Agent Control Center can run a deterministic test provider through
`ModelRouterPlanner` and the existing checkpointed workflow. The fixture
emits at most one list, read, or content-search step. Its allowlist and the
Tool Gateway apply before Tauri resolves the approved path. The fixture
operates on the task entered by the user. Saved memory and project knowledge
are used only by the separately confirmed configured-provider flow.

## Safety and recovery boundaries

- Agent and tool permissions default to deny.
- Workspace access is limited to owner-approved directories and native command validation.
- Tool inputs/outputs and plans have explicit size limits.
- MCP server descriptions and tool results are untrusted.
- Ambiguous external outcomes are shown for manual reconciliation. Reconciliation blocks blind retries; it does not assert whether an external side effect actually completed.
- Automatic replay of persisted external side effects is intentionally not implemented.
- The multi-agent coordinator's pending plan/output state is currently held in memory. Durable agent checkpoints exist, but a process restart does not yet guarantee end-to-end recovery of an entire multi-step coordination plan.
- Tool OAuth, broad browser/terminal execution, unrestricted shell access, specialist delegation, and autonomous background agents are not implemented.

## Release acceptance

Automated tests cover agent checkpoint transitions, approval grants, cancellation races, planner validation, Tool Gateway permissions, workspace tool integration, MCP transport bounds, and audit reconciliation. Native smoke tests still require an owner-operated desktop session and harmless test workspace. Never mark the phase complete solely because a build passes.
