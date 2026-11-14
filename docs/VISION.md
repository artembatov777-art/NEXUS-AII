# NEXUS AU — Personal AI Product Vision

## Purpose
NEXUS AU is a private personal AI ecosystem built for one primary owner. It combines a desktop workspace with a modular AI Core, local inference, and direct cloud-provider adapters. OmniRoute is deferred until final integration. NEXUS Model adaptation is a later development goal.

This is not a public multi-user SaaS product and must not remain a thin client for model aggregators. Its purpose is personal control, continuity across projects, integration with the owner's workflows, and the ability to evolve the model and the surrounding system together.

## Product identity
- Product: NEXUS AU
- Intelligence layer: NEXUS AI Core
- Primary model: NEXUS Model
- Audience: one primary owner, private personal use
- Deployment: hybrid local-and-cloud desktop with owner-controlled remote compute

## Principles
1. Personal-first, not public-SaaS-first. Multi-tenant accounts, billing, and public quotas are not requirements.
2. Hybrid model strategy: local inference where practical and direct, configurable cloud-provider adapters during core development, with optional OmniRoute integration at the end. NEXUS Model remains the long-term model-adaptation goal.
3. Own the complete system: model runtime, context, memory, agents, tools, data, and evaluation.
4. Local-first with honest trade-offs. Prefer local processing when practical; allow remote compute when hardware requires it.
5. Owner-configurable behavior, tools, integrations, memory rules, and workflows.
6. Data sovereignty: inspection, correction, export, backup, and deletion are first-class capabilities.
7. Observable execution: show model identity, context sources, agent activity, tool calls, errors, and resource use.
8. No fake capability claims. A feature is complete only after implementation and verification.
9. Safety protects the owner. Powerful integrations remain scoped, visible, interruptible, and recoverable.

## Core capabilities
- Personal AI chat and workspace.
- NEXUS Model as the primary inference target.
- Local and optional remote model runtimes behind stable contracts.
- Conversation context and inspectable long-term memory.
- Personal knowledge base with source provenance.
- Reasoning, planning, and bounded multi-agent workflows.
- Tool Gateway, MCP integrations, and owner-configured capabilities.
- Voice interaction and multimodal input/output.
- Personal automation with logs, cancellation, and configurable approvals.
- Model evaluation, dataset curation, fine-tuning experiments, and version management.

## Model development stages
1. Bootstrap: evaluate open-weight checkpoints and run one through a local inference adapter.
2. Personal adaptation: define behavior, retrieval, tools, and curated examples.
3. Fine-tuning: run controlled experiments when evaluation identifies a real gap and suitable data/compute exist.
4. Model ownership: maintain versioned weights/adapters, datasets, evaluation results, and rollback.
5. Long-term research: investigate training a foundation model from scratch only when data, compute, expertise, and budget justify it.

An open-weight starting checkpoint is a bootstrap strategy, not a claim that NEXUS created that base model. Prompting and retrieval are not training; fine-tuning is not foundation-model pretraining.

## Non-goals unless explicitly reconsidered
- Public multi-user SaaS, subscriptions, or tenant management.
- Direct coupling to individual cloud vendors; vendor details stay inside provider adapters, while local-only operation remains possible.
- Frontier-scale from-scratch pretraining as the first milestone.
- Unbounded background agents or invisible computer control.
- Automatic ingestion of all personal data into training.

## Initial priority
Finish and verify the existing desktop foundation. Then establish NEXUS AI Core model contracts and a working local inference vertical slice before expensive training work.
