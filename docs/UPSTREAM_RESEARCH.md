# Upstream Research and Adoption Decisions

Research snapshot: 2026-11-08. Repository metadata and upstream README/license files were inspected through GitHub. This is an engineering assessment, not a claim that every project has been exhaustively audited.

## Decision summary

| Project | Observed design | Fit for NEXUS AU | Decision |
|---|---|---|---|
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | TypeScript graph orchestration; stateful execution, durable execution, human-in-the-loop and memory concepts; MIT | High for a future graph planner, but larger than the current bounded runtime | Study and prototype behind an adapter after runtime contracts stabilize |
| [LangGraph Python](https://github.com/langchain-ai/langgraph) | Python implementation of the same low-level stateful agent approach; MIT | Lower fit for the current React/TS/Tauri core | Do not embed Python in the desktop core |
| [Mem0](https://github.com/mem0ai/mem0) | Memory layer with multi-level scope, entity linking, semantic + BM25 + entity retrieval, temporal reasoning; Apache-2.0 | High conceptually; current SDK and service stack is not a drop-in replacement for our local-first TS repository | Adapt retrieval ideas; retain user consent, provenance and local repository boundary |
| [LlamaIndex](https://github.com/run-llama/llama_index) | Data/RAG ingestion and retrieval ecosystem, primarily Python | Useful later for document ingestion/RAG; too broad for current memory feature | Defer; evaluate TypeScript package and licensing when document ingestion begins |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | Software-agent environment with tool execution and workspace isolation | Relevant to future coding agent, but introduces a much larger execution/security surface | Study sandbox boundaries later; never give agents raw host access |
| [awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) | Curated collection of standalone agent, RAG and voice examples; Apache-2.0 | Good pattern library, not a runtime dependency or architecture authority | Use to compare vertical slices and test/evaluation patterns; inspect individual examples before borrowing |

## Findings applied now

### Memory retrieval

Mem0's README describes combining semantic retrieval, BM25-style keyword retrieval, entity matching and temporal reasoning. NEXUS does not yet have embeddings, an entity graph, or an LLM extraction pipeline, so claiming equivalent semantic memory would be false.

The local adapter now uses a deterministic lexical ranker:
- inverse document frequency reduces the influence of terms present in nearly every memory;
- tag matches receive a modest relevance boost;
- category matches contribute less than content/tags;
- exact phrase and query coverage add small bonuses;
- recency is only a tie-breaker, not a substitute for relevance.

This remains lexical retrieval, not BM25-complete, vector search, or Mem0 integration. It is deliberately dependency-free and testable offline.

### Agent orchestration

LangGraph.js explicitly provides a JavaScript/TypeScript implementation and documents durable execution and human-in-the-loop. That is a better stack fit than adopting the Python LangGraph package. NEXUS currently has a bounded single-agent runtime, but no durable checkpoints or resumable approval state. The correct next comparison is a small isolated graph-runtime spike with persisted state and interrupt/resume tests, not a wholesale dependency import.

### Tool execution and safety

OpenHands is relevant as a reference for coding-agent execution environments, not as a reason to expose shell or filesystem capabilities to current agents. NEXUS's Tool Gateway remains the single enforcement point. A future execution backend must be isolated, scoped, cancellable, and audited.

## License and reuse notes

- LangGraph.js repository metadata reports MIT; its LICENSE file was inspected.
- LangGraph Python repository metadata reports MIT.
- Mem0 repository metadata reports Apache-2.0; its LICENSE file was inspected.
- awesome-llm-apps README identifies Apache-2.0; individual example dependencies and files still require their own review.
- Do not copy code from a repository until its license and the specific file's provenance are checked. Preserve required notices for any reused code.
- Repository-level license labels do not automatically cover third-party assets, datasets, model weights, or nested submodules.

## Sources

- https://github.com/langchain-ai/langgraphjs
- https://github.com/langchain-ai/langgraph
- https://github.com/mem0ai/mem0
- https://github.com/run-llama/llama_index
- https://github.com/All-Hands-AI/OpenHands
- https://github.com/Shubhamsaboo/awesome-llm-apps

## Next evaluations

1. Inspect LangGraph.js checkpoint saver and interrupt/resume implementation; compare its failure semantics with NEXUS AgentRuntime.
2. Inspect Mem0 OSS retrieval internals and separate open-source SDK behavior from hosted/proprietary benchmark claims.
3. Select one real RAG/document ingestion example from awesome-llm-apps and trace its dependencies, persistence, and tests.
4. Compare OpenHands workspace isolation with a minimal Tauri/Rust sandbox boundary before any coding-agent tool is implemented.
