# ADR 0002: Native Agent Checkpoints Before Framework Adoption

- Status: Accepted
- Date: 2026-11-08
- Decision owners: NEXUS AU maintainers

## Context

NEXUS AU has a bounded TypeScript agent runtime. Upstream research found that LangGraph.js provides durable checkpoint abstractions, versioned snapshots, pending writes, and human-in-the-loop execution. Its architecture is a strong reference, but adopting the complete graph runtime would introduce a large framework boundary before NEXUS has defined its own persistence, approval, and recovery semantics.

The project is also local-first and targets React + TypeScript + Tauri/Rust. Agent state must remain independent of a specific model provider and persistence engine.

## Decision

1. Define a small provider-neutral checkpoint contract in NEXUS core.
2. Version every snapshot and scope it to a run, agent, and thread.
3. Use monotonic sequence numbers and compare-and-swap writes to reject stale updates.
4. Restrict persisted state to bounded JSON values; do not serialize closures, iterators, SDK objects, or host capabilities.
5. Keep the current LocalStorage adapter explicitly limited to browser preview.
6. Integrate checkpoint persistence into a serializable step-based runtime before claiming crash recovery.
7. Re-evaluate LangGraph.js behind an adapter once resume and interrupt semantics have tests.

## Consequences

Positive:
- The core remains framework- and provider-neutral.
- Checkpoint format can be tested without a database or model API.
- Stale writes and malformed state are rejected.
- The application can later use SQLite without changing the domain contract.

Trade-offs:
- NEXUS must implement safe resume semantics itself.
- The current async-generator runtime cannot be resumed by restoring a checkpoint.
- LocalStorage is not encrypted, transactional across tabs, or suitable for sensitive production state.
- The checkpoint contract is groundwork, not a complete durable agent engine.

## Rejected alternatives

- **Adopt LangGraph.js immediately:** rejected until NEXUS has a tested persistence and approval boundary and a clear need for graph scheduling.
- **Serialize async-generator internals:** rejected because closures and iterator execution state are not portable or safely restorable.
- **Persist arbitrary JavaScript objects:** rejected due to unsafe serialization, hidden runtime state, and unbounded payloads.

## Revisit when

- A step-based agent definition and resume path are implemented.
- SQLite checkpoint storage and migrations are available.
- Approval interrupts can be resumed with one-time, run-bound authorization.
- A measured requirement demonstrates that a graph scheduler materially improves the product.
