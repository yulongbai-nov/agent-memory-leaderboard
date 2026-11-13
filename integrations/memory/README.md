# Textual memory adapters

The loopback service implements the Textual payloads in the
[AML Add/Search guide](https://agentmemoryleaderboard.ai/api-guide).
OpenSquilla uses native session indexing and search in an isolated Python
runtime. OpenViking uses session extraction and indexes dated source turns.
A separate native store or server namespace isolates each user. Each write
chunk has its own stable ID and identical retries are acknowledged once per
process. Start a fresh process and a fresh state directory for each run.

Use Python 3.13 and install the repository’s requirements. For OpenSquilla,
install the pinned wheel from the workflow in a separate environment and set
`OPENSQUILLA_PYTHON` to its Python executable. Set `OPENAI_API_KEY` for
text-embedding-3-small, or set `OPENSQUILLA_EMBEDDING=` for native keyword
search. OpenViking requires an already running server and
`OPENVIKING_API_KEY`. The workflow gives its pinned configuration.

```sh
export AML_ADAPTER_KEY=loopback-smoke
python integrations/memory/service.py opensquilla --state-dir "$(mktemp -d)/index"
```

From another shell with the same `AML_ADAPTER_KEY`, run
`python integrations/memory/smoke.py --output smoke-results/local.json`.
The two synthetic probes check immediate recall, authentication, retry
acknowledgment, and user isolation. The adapter listens on localhost and
keeps one request in flight. The workflow reads the provider key from the
new fork if configured, with a keyword-only OpenSquilla path when absent.

The public comparison uses the RonsenbergVI harness. Official AML uses its
own data, models, orchestration, and scoring. These Textual adapters and the
published smoke results are independent of official AML submissions.
