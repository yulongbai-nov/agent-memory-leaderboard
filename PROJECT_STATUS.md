# Independent agent memory benchmark

The public AML fork hosts an independent benchmark report, inspired by AML’s
separate track tables and linked evidence. The first report draws on the
[RonsenbergVI benchmark harness](https://github.com/RonsenbergVI/agent-memory-benchmarks).
Its results use the stated local protocols and have no standing in the official
AML rankings.

- [x] Fork AML and preserve its upstream answer and evaluation code.
- [x] Run OpenSquilla, OpenViking, eight other frameworks, and BM25 in the
  same three-question LoCoMo protocol. All 11 completed on GitHub-hosted
  four-vCPU runners. [Matched run](https://github.com/yulongbai-nov/agent-memory-benchmarks/actions/runs/43340331343)
- [x] Add the matched quality, latency, memory, token and per-question results
  to the site alongside 64 upstream results in their own cohorts.
- [x] Implement local Textual Add and Search adapters for both frameworks.
- [x] Verify the OpenSquilla Textual HTTP adapter locally in native keyword
  mode. Two synthetic retrieval probes, duplicate Add, authentication, and
  user isolation passed.
- [ ] Verify both Textual HTTP adapters with live providers from this fork.
- [ ] Add a larger matched public corpus and the in-house memory candidate.

[GitHub Pages](https://yulongbai-nov.github.io/agent-memory-leaderboard/)
