# NEXUS AU Training Lab

## Current scope

The current Training Lab increment supports governed dataset manifests, explicit JSON/JSONL sample import and JSONL export, live provider comparisons, deterministic phrase evaluation, and immutable experiment records. It does not yet train or fine-tune model weights.

## Dataset manifest

Each dataset version must record:

- Stable manifest ID and monotonically increasing version.
- Dataset name, license, source references, and creation timestamp.
- Privacy class: public, synthetic, or owner-approved.
- Consent state: only approved or not-required manifests are accepted for evaluation/training workflows.
- Explicit approval reference for owner-selected material.
- Disjoint train, validation, and test item IDs.
- Optional sample records with input, expected output, and a split assignment. Imported samples must exactly match the manifest IDs and remain within the 900 KB content limit.

Import accepts a JSON array or JSONL rows shaped as `{ "id": "case-1", "split": "train", "input": "...", "expectedOutput": "..." }`. The owner explicitly selects the file; privacy class, license, provenance, and consent must still be reviewed before saving. Sample content is persisted with its immutable dataset version in SQLite and can be exported as JSONL.

Private conversations, memories, workspace files, and chat histories are excluded by default. They must never be silently collected into a dataset. The import UI requires explicit owner selection. Owner-approved private material requires an approved consent state and a durable approval reference before it can be saved.

## Experiment record

Each experiment records the model ID, method, dataset manifest version, code revision, hardware, configuration, metrics, and timestamp. Secret-bearing configuration keys such as API keys, access tokens, passwords, and credentials are rejected.

## Evaluation

Evaluation suites contain stable case IDs, prompts, and expected outputs. The live dataset evaluator sends only held-out test-split inputs to the selected provider, keeps expected outputs local, records per-case latency, and reports exact-match and expected-output containment rates. One run is bounded to 1,000 test cases and can be cancelled. The manual phrase scorer remains a deterministic regression signal, not a semantic quality benchmark. Semantic grading, human review, cost, robustness, and regression comparisons remain future work.

## Deferred

- Model weight training and LoRA execution.
- Training runtime execution and LoRA fine-tuning.
- Artifact/checkpoint registry and hardware scheduling.
- Semantic evaluation, human review, cost and robustness metrics.
- Artifact registry and checkpoint recovery.
- Hardware scheduling and checkpoint recovery.
- Automatic ingestion of personal data (not planned).
