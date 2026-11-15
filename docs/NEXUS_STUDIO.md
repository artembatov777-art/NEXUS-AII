# NEXUS Studio — feature contract

NEXUS Studio is a workspace layer, not a claim that every card is an autonomous AI agent. Each feature must expose its actual data source and capability boundary.

## Included capabilities

| Feature | Current behavior | Data / integration boundary |
|---|---|---|
| Daily Briefing | Builds a live summary from open inbox items, projects, and the three most recently updated conversations | Derived locally from loaded workspace state; no scheduled background report |
| Universal Inbox | Captures titled notes and ideas, marks items complete, deletes items, and persists the list | Browser local storage on the current device; not yet synchronized with native SQLite or other devices |
| Knowledge Graph | Combines current project/conversation context with owner-created concept nodes and manually created relationships | Owner-created nodes and edges persist in browser local storage; project/conversation context is read-only |
| Workflow Studio | Creates reusable checklists, tracks step completion, and persists workflow definitions | Checklist tracking only; it does not execute arbitrary tools or automation jobs |
| Focus Mode | Toggles the existing distraction-reduced workspace presentation | Uses the app's existing focus-mode state |
| Workspace Analytics | Calculates conversation, message, project, and inbox counts from loaded local records | No external analytics service; no inferred productivity score |
| Agent Command Center | Opens the existing agent runtime, approval, checkpoint, and trace interface | Execution is governed by existing agent budgets, tool permissions, and approval gates |
| Smart File Intelligence | Opens the native file manager for approved-folder browsing, search, preview, and guarded file operations | Native host only; explicit folder grants and file-operation safeguards apply |
| Voice Control | Opens chat with the existing browser/WebView speech controls | Host-dependent speech APIs; not native/offline STT/TTS |
| System Guardian | Reports observable workspace readiness, provider configuration/verification, and native-runtime availability | Reports only states available to the UI; it is not a background monitoring daemon |

## Persistence and validation

- Studio browser records are treated as untrusted input.
- Each collection has a 1 MiB serialized-data ceiling, an item-count ceiling, field-level size/type validation, and duplicate-ID rejection.
- Invalid records are ignored rather than rendered as trusted workspace objects.
- Storage failures are surfaced in the Studio panel.
- No provider key or credential is stored by Studio.

## Deliberate non-claims

The following are not implemented by the current Studio UI and must not be described as complete:
- scheduled/background Daily Briefing delivery;
- cross-device inbox or graph synchronization;
- automatic semantic graph extraction from all documents;
- arbitrary workflow execution or unattended tool access;
- productivity scoring or external telemetry;
- always-on voice listening or offline speech recognition;
- background health monitoring and automatic remediation.

These require additional backend services, explicit permissions, durable persistence, and release acceptance tests. The visible Studio modules are useful local workspace features and entry points into existing NEXUS subsystems, not substitutes for those services.
