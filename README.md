# NEXUS AU

**A personal AI ecosystem built for one owner.**

NEXUS AU is a hybrid local-and-cloud desktop environment and long-term engineering project for building a personally controlled AI system: its own model, memory, reasoning and context services, agents, tools, and automation. Native/offline voice is deferred; current browser/WebView speech controls are host-dependent and do not imply a native voice runtime.

The strategic goal is not to publish a multi-user AI service or remain a thin client for model aggregators. The goal is to develop **NEXUS Model** as the primary intelligence of a private AI environment. Direct local and cloud provider adapters use a provider-neutral interface; no gateway is required during core development.

## Product direction
- **Personal-first:** designed around one owner's workflows, preferences, projects, and devices. Multi-user accounts, public SaaS billing, and public quotas are not product requirements.
- **Own model as the destination:** an existing open-weight model may be used as a practical starting checkpoint; it is not the final product.
- **Independent AI Core:** model execution, context assembly, memory retrieval, agent orchestration, tools, and evaluation are separate modules.
- **Hybrid by design:** local inference is used where practical; cloud models connect directly through compatible provider endpoints. The UI must make remote processing visible, and private data is never sent to training automatically.
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

NEXUS AU currently connects directly to compatible local runtimes and cloud provider endpoints through a provider-neutral router. No OmniRoute-specific profile builder or gateway connection is implemented. An optional gateway adapter may be evaluated only during final integration if the owner chooses, without making it a core dependency.

## Practical model strategy
1. Establish a provider-neutral model runtime with direct cloud-provider adapters and local inference adapters.
2. Select an open-weight base model after evaluating quality, license, hardware needs, and inference support.
3. Build reproducible datasets and evaluation suites from permitted, curated material.
4. Adapt the model for the owner's workflows using configuration, prompting, retrieval, and parameter-efficient fine-tuning where useful.
5. Consider training a foundation model from scratch only when data, compute, expertise, and budget justify it.

Prompting, retrieval, fine-tuning, and foundation-model pretraining are different activities and must not be conflated.

## Current implementation
The repository already contains a React + TypeScript + Vite frontend, a Tauri 2 / Rust desktop host, local persistence, memory and knowledge retrieval, agent runtime foundations, MCP HTTP integration, permission-gated tool execution, credential-vault support, and cross-platform CI.

These facts do not mean every planned feature is production-ready. See `docs/ROADMAP.md` and `DEVELOPMENT_STATUS.md` for the active seven-phase order and verified status; use `docs/PLATFORM_SMOKE_TESTS.md` and `docs/OWNER_SMOKE_TESTS.md` for manual acceptance.

## Technology
- Frontend: React, TypeScript, Vite.
- Desktop: Tauri 2, Rust.
- Storage: SQLite plus bounded local indexes and managed attachment storage.
- Model layer: provider-neutral contracts, direct local inference adapters, and compatible cloud-provider adapters; any gateway adapter remains optional future work.
- Agent integrations: Tool Gateway and MCP.
- Quality: unit/integration tests, CI, security review, and real desktop smoke tests.

## Terminal transition

A terminal entry point is under development. Run `npm run cli` or `npm run cli -- --help`. The shell includes an `/agent` command, but does not yet connect to a model, access project files, or execute commands; the existing desktop application remains available while its capabilities are migrated. See [the transition plan](tasks/plan.md) and [task list](tasks/todo.md).

## Development

For platform prerequisites, installer artifacts, and first-launch setup, see [docs/INSTALLATION.md](docs/INSTALLATION.md).

~~~bash
npm ci --legacy-peer-deps
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
- Desktop installation and build artifacts: docs/INSTALLATION.md

### Offline CLI test fixture

`npm run cli -- --test-model` starts a deterministic echo fixture labelled `TEST MODEL`; it echoes chat input. In an interactive test session, select a project with `/project` and run `/agent read <relative file>` to exercise the offline planner. The shared Tool Gateway asks for approval and records the read before the Rust host runs it. Completed turns are stored in `~/.nexus-au/test-history.json`. Use `--history PATH` after `--test-model` to select a separate history file. The file contains conversation text; it is not encrypted and is not compatible with Desktop history. An invalid history file stops startup without overwriting it. Ctrl-C cancels the active terminal session. Normal CLI mode still has no configured provider.

### CLI workspace

With stable Rust and the npm dependencies installed, run `npm run build:workspace` and `npm run cli` in a terminal. Use `/project <absolute directory>` to grant access for this session. Use `/files [relative directory]`, `/read <relative file>`, or `/search <literal text>` and confirm the displayed read permission. Search returns matching paths, scanning at most 1,000 entries down to eight subdirectory levels and returning up to 100 paths. Files must be UTF-8 and at most 48,000 bytes. Ctrl-C closes the session. The CLI stores tool audit records under `~/.nexus-au/workspace-audit/`.
