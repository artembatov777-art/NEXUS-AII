# NEXUS AU

**A personal AI ecosystem built for one owner.**

NEXUS AU is a local-first desktop environment and long-term engineering project for building a personally controlled AI system: its own model, memory, reasoning and context services, agents, tools, voice interface, and automation.

The strategic goal is not to publish a multi-user AI service or remain a thin client for model aggregators. The goal is to develop **NEXUS Model** as the primary intelligence of a private AI environment, while keeping replaceable adapters for external models during development, evaluation, and fallback.

## Product direction
- **Personal-first:** designed around one owner's workflows, preferences, projects, and devices. Multi-user accounts, public SaaS billing, and public quotas are not product requirements.
- **Own model as the destination:** an existing open-weight model may be used as a practical starting checkpoint; it is not the final product.
- **Independent AI Core:** model execution, context assembly, memory retrieval, agent orchestration, tools, and evaluation are separate modules.
- **Local-first, hybrid-capable:** private data and suitable inference stay local where practical. Optional remote compute may be used when hardware requires it.
- **Owner-configurable:** the owner chooses model behavior, tools, integrations, memory policy, and automation workflows.
- **Transparent and recoverable:** runs are observable, data can be backed up, and consequential actions can be interrupted or reviewed.

## Target architecture

~~~text
NEXUS AU desktop
  └─ NEXUS AI Core
      ├─ Model Runtime / Model Registry
      ├─ Context & Memory Engine
      ├─ Reasoning / Planning
      ├─ Agent Runtime & Coordinator
      ├─ Tool Gateway / MCP
      ├─ Multimodal I/O
      ├─ Personal Knowledge & Workspace
      └─ Evaluation, Training & Model Lifecycle
             └─ NEXUS Model (primary)
                 ├─ initial open-weight checkpoint
                 ├─ personal fine-tuning / adapters
                 └─ long-term independent model research
~~~

External model APIs are optional adapters, not the architectural center. OmniRoute is not a required dependency.

## Practical model strategy
1. Establish a provider-neutral model runtime and local inference adapter.
2. Select an open-weight base model after evaluating quality, license, hardware needs, and inference support.
3. Build reproducible datasets and evaluation suites from permitted, curated material.
4. Adapt the model for the owner's workflows using configuration, prompting, retrieval, and parameter-efficient fine-tuning where useful.
5. Consider training a foundation model from scratch only when data, compute, expertise, and budget justify it.

Prompting, retrieval, fine-tuning, and foundation-model pretraining are different activities and must not be conflated.

## Current implementation
The repository already contains a React + TypeScript + Vite frontend, a Tauri 2 / Rust desktop host, local persistence, memory and knowledge retrieval, agent runtime foundations, MCP HTTP integration, permission-gated tool execution, credential-vault support, and cross-platform CI.

These facts do not mean every planned feature is production-ready. See the implementation plan and platform smoke-test protocol for verified status and remaining manual checks.

## Technology
- Frontend: React, TypeScript, Vite.
- Desktop: Tauri 2, Rust.
- Storage: SQLite plus bounded local indexes and managed attachment storage.
- Model layer: provider-neutral contracts with local and optional remote adapters.
- Agent integrations: Tool Gateway and MCP.
- Quality: unit/integration tests, CI, security review, and real desktop smoke tests.

## Development

~~~bash
npm install
npm run dev
npm run build
npm run tauri dev
~~~

## Project documentation
- Product vision: docs/VISION.md
- System architecture: docs/ARCHITECTURE.md
- System design: docs/SYSTEM_DESIGN.md
- Module contracts: docs/MODULE_CONTRACTS.md
- Development roadmap: docs/ROADMAP.md
- Implementation status: docs/IMPLEMENTATION_PLAN.md
- Security model: docs/SECURITY.md
- Platform smoke tests: docs/PLATFORM_SMOKE_TESTS.md
