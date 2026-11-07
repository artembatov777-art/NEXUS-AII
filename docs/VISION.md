# NEXUS AU — Product Vision

## Purpose

NEXUS AU is a modular, local-first AI desktop environment that brings multiple AI providers, persistent memory, specialized agents, tools, voice interaction, and workflow automation into one user-controlled workspace.

It is intended to become a practical AI work environment, not merely a chat interface or a static UI demo.

## Product principles

- **User control:** the user decides what the system can access, remember, and execute.
- **Modularity:** providers, memory, agents, and tools remain replaceable components.
- **Local-first:** keep personal data and application state local by default where practical.
- **Transparency:** show active models, agent activity, tool calls, errors, and permission requests.
- **Security by design:** secrets are never committed; sensitive actions require explicit authorization.
- **Honest status:** a feature is not considered complete until implemented and tested.

## Core capabilities

1. Multi-provider AI chat with conversation history and streaming.
2. Configurable model routing through an OmniRoute-compatible adapter.
3. User-controlled long-term memory with search and project separation.
4. Specialized AI agents coordinated through bounded workflows.
5. MCP and application tool integrations with scoped permissions.
6. Voice input and text-to-speech.
7. Workspace for projects, notes, files, and tasks.
8. Auditable workflow automation.

## Target platform

The initial target is Windows desktop using Tauri 2, React, TypeScript, and Rust. The architecture should avoid unnecessary platform coupling so other platforms can be considered later.

## Non-goals for the first release

- Autonomous unrestricted computer control.
- Hidden background monitoring.
- Unbounded agent-to-agent execution.
- A cloud account requirement for basic local application functions.
- Claiming integrations work before they have been tested.

## Initial milestone

Deliver a reliable foundation: application shell, navigation, design system, provider configuration, working chat, local conversation persistence, error handling, and automated checks.
