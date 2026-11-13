"""Build a versioned question bank from publicly released AML-related datasets."""

import argparse
import ast
import csv
import hashlib
import json
import shutil
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEED = "memory-bench-public-v1"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def verified_file(source, cache):
    path = cache / source["path"]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(path.suffix + ".part")
        with (
            urllib.request.urlopen(source["url"], timeout=90) as response,
            partial.open("wb") as output,
        ):
            shutil.copyfileobj(response, output)
        partial.replace(path)
    with path.open("rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != source["sha256"]:
            raise ValueError(f"Unexpected source checksum for {path}")
    return path


def jsonl(path):
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def parquet(path, columns):
    from pyarrow.parquet import ParquetFile

    for batch in ParquetFile(path).iter_batches(columns=columns):
        yield from batch.to_pylist()


def records(suite, path):
    """Yield source ID, sampling group, and prompt from the native release."""
    if suite == "locomo-refined":
        for row in jsonl(path):
            if not row["is_multi_modality"]:
                yield row["qa_id"], str(row["category"]), row["question"]
    elif suite == "scriptmem":
        for row in jsonl(path):
            yield row["qa_id"], str(row["qa_type"]), row["question"]
    elif suite == "longmemeval-s":
        for row in json.loads(path.read_bytes()):
            yield row["question_id"], row["question_type"], row["question"]
    elif suite == "clbench":
        for row in jsonl(path):
            meta = row["metadata"]
            yield (
                meta["task_id"],
                meta["context_category"],
                row["messages"][-1]["content"],
            )
    elif suite == "personamem-v2":
        with path.open(encoding="utf-8", newline="") as handle:
            for index, row in enumerate(csv.DictReader(handle)):
                if row["chat_history_32k_link"]:
                    yield (
                        f"benchmark/text/benchmark.csv:{index}",
                        row["pref_type"],
                        row["user_query"],
                    )
    elif suite == "beam":
        for row in parquet(path, ["conversation_id", "probing_questions"]):
            raw = row["probing_questions"]
            groups = ast.literal_eval(raw) if isinstance(raw, str) else raw
            for category, questions in groups.items():
                for index, question in enumerate(questions):
                    yield (
                        f"{row['conversation_id']}:{category}:{index}",
                        category,
                        question["question"],
                    )
    elif suite == "swe-contextbench":
        for row in parquet(path, ["instance_id", "repo", "problem_statement"]):
            yield row["instance_id"], row["repo"], row["problem_statement"]
    elif suite in {"memeye", "mem-gallery"}:
        for index, row in enumerate(
            json.loads(path.read_bytes())["human-annotated QAs"]
        ):
            ident = row.get("question_id", index)
            yield f"{path.stem}:{ident}", path.stem, row["question"]
    elif suite == "atm-bench-hard":
        for row in json.loads(path.read_bytes()):
            yield row["id"], row["qtype"], row["question"]
    else:
        raise ValueError(f"Unknown suite {suite}")


def select(suite, cache, include_prompts):
    groups = defaultdict(list)
    seen = set()
    for source in suite["files"]:
        path = verified_file(source, cache)
        for ident, group, prompt in records(suite["id"], path):
            if ident in seen:
                raise ValueError(f"Duplicate ID {suite['id']}/{ident}")
            seen.add(ident)
            if not isinstance(prompt, str) or not prompt.strip():
                continue
            row = {
                "id": ident,
                "group": group,
                "source_file": source["path"],
                "prompt_sha256": digest(prompt),
            }
            if include_prompts:
                row["prompt"] = prompt
            groups[group].append(row)
    queues = [
        deque(sorted(rows, key=lambda row: digest(f"{SEED}/{suite['id']}/{row['id']}")))
        for _, rows in sorted(groups.items())
    ]
    selected = []
    while queues and len(selected) < suite["minimum"]:
        for queue in queues:
            selected.append(queue.popleft())
            if len(selected) == suite["minimum"]:
                break
        queues = [queue for queue in queues if queue]
    if len(selected) != suite["minimum"]:
        raise ValueError(f"Too few released questions for {suite['id']}")
    return {
        **suite,
        "eligible_questions": sum(map(len, groups.values())),
        "questions": selected,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--include-prompts",
        action="store_true",
        help="Include exact source prompts for local use.",
    )
    args = parser.parse_args()
    csv.field_size_limit(10_000_000)
    sources = json.loads((HERE / "sources.json").read_bytes())
    result = {
        "version": SEED,
        "suites": [
            select(suite, args.cache, args.include_prompts) for suite in sources
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    for suite in result["suites"]:
        print(
            f"{suite['track']:10} {suite['label']:25} {len(suite['questions']):2} / {suite['eligible_questions']} eligible"
        )


if __name__ == "__main__":
    main()
