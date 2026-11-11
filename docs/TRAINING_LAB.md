# NEXUS AU Training Lab

## Current scope

The first Training Lab increment establishes governance and evaluation primitives. It does not train, fine-tune, upload, or export any model weights.

## Dataset manifest

Each dataset version must record:

- Stable manifest ID and monotonically increasing version.
- Dataset name, license, source references, and creation timestamp.
- Privacy class: public, synthetic, or owner-approved.
- Consent state: only approved or not-required manifests are accepted for evaluation/training workflows.
- Explicit approval reference for owner-selected material.
- Disjoint train, validation, and test item IDs.

Private conversations, memories, workspace files, and chat histories are excluded by default. They must never be silently collected into a dataset. A future import workflow must require explicit owner selection and a durable approval record.

## Experiment record

Each experiment records the model ID, method, dataset manifest version, code revision, hardware, configuration, metrics, and timestamp. Secret-bearing configuration keys such as API keys, access tokens, passwords, and credentials are rejected.

## Evaluation

Evaluation suites contain stable case IDs, prompts, and required phrases. The baseline scorer reports per-case results, pass rate, and matched phrase counts. This deterministic scorer is a starting point, not a complete quality benchmark: semantic grading, human review, latency distributions, cost, robustness, and regression comparisons remain future work.

## Deferred

- Model weight training and LoRA execution.
- Dataset file storage and import/export UI.
- Experiment persistence and artifact registry.
- Hardware scheduling and checkpoint recovery.
- Automatic ingestion of personal data (not planned).
