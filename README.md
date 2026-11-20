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

A terminal entry point is under development. Run `npm run cli` or `npm run cli -- --help`. Its local Rust workspace host supports explicitly selected projects, bounded file inspection and approval-gated draft operations on supported platforms. It is **not** yet a complete model-driven coding agent: live providers remain disconnected, and Desktop/CLI session and agent runtimes are not fully unified. The existing desktop application remains available during migration. See [the transition plan](tasks/plan.md) and [task list](tasks/todo.md).

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

### Inspect local CLI history and audit

In offline test mode, `/history` shows the last 10 completed turns; `/history last 5` selects a smaller window and `/history find text` searches locally without calling a model. Content previews are length-bounded and terminal-escaped. The CLI reads history using a bounded, no-follow file inspection path and validates complete user/assistant turn pairs before saving. The test history file is plaintext and is **not** a Desktop history database.

The interactive CLI can inspect the local Tool Gateway audit even without an AI provider. Use `/audit recent` to find recent run IDs, `/audit <run-id>` to view the last 20 recorded events, or `/audit <run-id> last 10` for a shorter window. Audit records are written to `~/.nexus-au/workspace-audit/` with bounded append-only journals and file checks. Missing or damaged records are not treated as proof that a tool is safe to replay. The command only reads the audit, never executes actions or approves a retry.

The CLI does not yet guarantee exactly-once external tool effects after a crash. Journal permissions use POSIX owner checks on Unix; Windows ACL policy must additionally be checked on the installed desktop by the owner.

### CLI workspace

With stable Rust and the npm dependencies installed, run `npm run build:workspace` and `npm run cli` in a terminal. Use `/project <absolute directory>` to grant access for this session. Use `/files [relative directory]`, `/read <relative file>`, or `/search <literal text>` and confirm the displayed read permission. Search returns matching paths, scanning at most 1,000 entries down to eight subdirectory levels and returning up to 100 paths. Files must be UTF-8 and at most 48,000 bytes. Ctrl-C closes the session. The CLI stores tool audit records under `~/.nexus-au/workspace-audit/`.

In interactive test mode, `/agent list [directory]` lists entries and
`/agent search <text>` searches file contents through the same gateway.

On Windows 10/11 x64, run `npm run prepare:windows-host` with the Rust MSVC
toolchain before first running `npm run cli`. The host supplies revisioned
snapshots for browsing, search and draft review. Windows CLI apply and
rollback remain gated on native write validation. See the
[Windows build and verification instructions](docs/INSTALLATION.md#windows-10-and-11-x64).

#### Plan workspace changes

The interactive CLI has a deterministic workspace planner that runs locally
without a model, including in normal CLI mode. A plain-text goal lists the
project root and, for a goal of up to 256 UTF-8 bytes, searches for it as a
literal string. For scoped discovery or exact replacements, supply JSON.
`directory` scopes the listing and search. The replacement paths are always
relative to the selected project.

```text
/project /absolute/path/to/project
/agent plan {"goal":"Update the label in the guide and source","query":"old label","changes":[{"path":"README.md","from":"old label","to":"new label"},{"path":"src/labels.ts","from":"old label","to":"new label"}]}
/agent inspect
/agent diff
/approve
/apply
/agent status
```

The planner shows candidates, proposed actions, captured revisions, expected
content hashes and risks. Listing, search and file snapshots each require
permission. The plan ID and hash identify the reviewed content. Showing the
complete diff is required before approval. Plain-text goals produce
read-only plans, and write plans require explicit replacements. Workspace
contents stay local. Plans and approvals are session-local.
Completed or interrupted apply attempts can be inspected using their durable
operation ID after restarting the CLI.

For one file, use `/draft {"path":"note.txt","from":"old text","to":"new text"}`.
For multiple files, pass a JSON array with up to eight replacements, one per
file. Each old span must appear exactly once. The CLI shows all replacements
and a plan hash. Use `/approve` to check and approve that plan as a unit.
`/discard`, selecting a project, or exiting clears the plan. On Linux, use
`/apply` and confirm the plan's write permission at the prompt. Approval expires
after five minutes. Each apply attempt consumes the approval, including an
attempt that fails. Rebuild the Rust host with `npm run build:workspace` before
using these commands.

Before sending any writes, the gateway compares the current snapshots and
revisions of all files. The Rust host then reapplies the individual checks
under the directory lock for each replacement. Files are replaced in plan
order. If a later file fails or the connection goes away, earlier successful
replacements stay in place. There is no automatic rollback or retry.

Apply supports owner-owned UTF-8 files in owner-owned directories without
group or public write access. Hard links, symlinks and unsupported file
metadata are refused. The Rust host locks the directory for cooperating NEXUS
writers and verifies the snapshot again immediately before replacing the
original with a synced file staged anonymously in the same directory. Replacement uses the atomic
rename semantics of the underlying filesystem. The revision check and rename
are separate operations, so avoid editing the same file with external programs
during apply. Use a local filesystem that supports directory locking, atomic
rename, anonymous staging, procfs and sync.

A failure before rename leaves the original intact. If the host is interrupted
during staging, Linux releases the anonymous file. An interruption after the
fully synced staging file gets a name but before rename can leave a
`.nexus-edit-*` file. The CLI leaves such files alone. Review an orphan before
removing it, and only after confirming its writer has exited.

Before dispatching an edit, the CLI persists an intent with the project, file
paths, original revisions and SHA-256 hashes of both versions. Original text
goes into a separate recovery store. The per-attempt `.edit.json.steps`
journal records preflight and file dispatch
intent and outcomes as they are known. A dispatch intent without an outcome
can mean the file was replaced but its reply was lost. It prints the recovery
ID, also stored as the basename of a `.edit.json` file under
`~/.nexus-au/workspace-audit/`. If the host loses its reply, or directory sync
fails after rename, reselect the same project and run `/recover <ID>`. The
gateway requests read permission and reports for each file whether it currently
matches the original revision, matches the proposed bytes, or differs.
The result also shows whether the journal confirms that revision, records a
dispatch without confirmation, or has no usable evidence. A byte match alone
leaves the write outcome unconfirmed. Power-loss durability depends on the
filesystem and platform. Recovery only inspects the workspace.
A retry requires a fresh draft and approval.
To undo a completed or partially applied plan, run `/rollback <apply ID>`
with the same project selected. The command previews the reverse changes in
reverse application order. It includes only files whose current bytes and
revision match a durably recorded Rust write receipt. It skips conflicts,
files that already contain the original bytes, and writes without a receipt.
Older intents without saved content and receipts still support `/recover`.

Use a fresh `/approve` for this preview, then `/apply`. The approval expires
after five minutes and allows one apply attempt. The same gateway and Rust
checks apply to the reverse plan. Each file replacement is separate. If the
rollback stops part-way through, use `/recover <rollback attempt ID>` to
inspect it, then prepare a new rollback from the original apply ID for any
remaining eligible files. A side edit can still race the final native
revision check and rename.

For new operations the CLI stores original file contents in
`~/.nexus-au/workspace-recovery/` (directory mode `0700`, files `0600`).
These local backups are plaintext. SHA-256 checksums detect corruption
and bind backups and write receipts to the operation. Anyone who can rewrite
these files as your user can also recompute the checksums. The CLI refuses
rollback if the backup or journal fails verification. `/recover` can still
inspect files using intact audit metadata if the backup is unavailable.
Existing journals stay in place, including the original text in version 3
journals. Linux writes require a current workspace host with write-receipt
support and durable audit and recovery storage.
Windows and macOS hosts support discovery, preview and approval. CLI writes
remain disabled on both platforms.

To run the Linux terminal integration suite, build the CLI and Rust host with
`npm run build:cli` and `npm run build:workspace`, then run
`python3 scripts/test-workspace-pty.py` with Python `pexpect` installed.
