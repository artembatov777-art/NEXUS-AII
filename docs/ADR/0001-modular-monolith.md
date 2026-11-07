# ADR 0001: Start with a modular monolith

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

NEXUS AU needs clear boundaries between conversation management, model routing, memory, agents, tools, and desktop integration. Starting with multiple independently deployed services would add deployment, networking, and operational complexity before the product has stable contracts.

## Decision

Build a modular monolith. Keep domain and application modules independent of React, Tauri, databases, and provider-specific HTTP implementations. Use interfaces (ports) for infrastructure adapters. Extract a service only when scale, security isolation, or independent deployment gives a measurable benefit.

## Consequences

- Easier local development and integration testing.
- One release artifact initially.
- Module boundaries must be enforced through imports and code review.
- Long-running tasks still need explicit cancellation, timeouts, and resource budgets.
