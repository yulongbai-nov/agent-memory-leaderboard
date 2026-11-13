"""Extract matched public upstream cohorts from a pinned benchmark checkout."""

import argparse
import json
import subprocess
from collections import defaultdict
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    args = parser.parse_args()
    checkout = args.checkout
    commit = subprocess.check_output(
        ["git", "log", "-1", "--format=%H", "--", "runs"], cwd=checkout, text=True
    ).strip()
    source = f"https://github.com/RonsenbergVI/agent-memory-benchmarks/blob/{commit}"
    cohorts = defaultdict(list)
    keys = (
        "system",
        "system_version",
        "num_questions",
        "errors",
        "judge_accuracy",
        "attribution",
        "hits_per_query",
        "search_latency",
        "answer_latency",
        "ingest",
        "memory_tokens_total",
        "usage_coverage",
        "ingestion_model",
        "embedding_model",
    )
    for path in sorted((checkout / "runs").rglob("summary.json")):
        row = json.loads(path.read_text())
        group = tuple(
            row.get(key)
            for key in (
                "dataset",
                "variant",
                "k",
                "num_samples",
                "num_questions",
                "model",
                "judge_model",
                "workers",
            )
        )
        cohorts[group].append(
            {
                "summary": {key: row[key] for key in keys if key in row},
                "url": f"{source}/{path.relative_to(checkout).as_posix()}",
            }
        )
    archive = []
    for group, runs in sorted(
        cohorts.items(), key=lambda item: (item[0][0], -item[0][2])
    ):
        dataset, variant, k, samples, questions, model, judge, workers = group
        label = "LoCoMo" if dataset == "locomo" else "LongMemEval"
        if variant:
            label += f" {variant}"
        label += f" · k={k} · {questions:,} questions · {workers} workers"
        archive.append(
            {
                "label": label,
                "dataset": dataset,
                "variant": variant,
                "k": k,
                "num_samples": samples,
                "model": model,
                "judge": judge,
                "runs": runs,
            }
        )
    print(json.dumps(archive, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
