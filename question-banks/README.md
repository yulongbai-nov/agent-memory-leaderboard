# Public benchmark question banks

This bank selects fixed questions from author-published datasets featured by
or referenced by [Agent Memory Leaderboard](https://github.com/AML-memory/agent-memory-leaderboard).
The official AML bundle and CAMBench coding tasks are held out. The bank uses
SWE-ContextBench Lite as the public coding suite. ScriptMem publishes QA but
omits its original scripts, so its selected questions are catalogued without
an end-to-end memory score.

The [published manifest](../site/question-banks.json) contains 301 selected
records across ten suites. It stores pinned source URLs, source file
checksums, stable question IDs or zero-based source row positions, categories,
and a SHA-256 of each exact prompt. For BEAM, IDs are conversation, question
type and zero-based position. For the multimodal dialogue sets, IDs include
the scenario and native question ID or zero-based question position.

Within each suite, the builder sorts questions by a seeded hash and selects
in round-robin order across available categories, repositories, or scenarios.
LoCoMo-Refined uses text-only items. ATM-Bench-Hard includes all 31 released
questions. MemEye uses the open-ended form to avoid counting the mirrored
multiple-choice versions as extra questions.

```sh
uv run --no-project --python 3.13 --with pyarrow==26.0.1 \
  python question-banks/build.py --cache /tmp/agent-memory-benchmark-data \
  --output /tmp/public-question-bank.json --include-prompts
```

Omit `--include-prompts` to reproduce the published manifest. Exact prompts
can be materialized locally. Ground truths, rubrics, coding patches and
original evidence stay in their respective upstream releases. The selections
do not contain system scores. Future scored runs must use the same selected
IDs per candidate, use each suite’s source history and scoring rules, and
record media input mode and the coding verifier separately from textual QA.
