"""Exercise the Textual Add/Search boundary against a running native backend."""

import argparse
import json
import os
import platform
import time
from pathlib import Path

import httpx

CASES = (
    ("I adopted a tortoise named Saffron.", "What is my tortoise named?", "Saffron"),
    (
        "The observatory access phrase is Quartz Lantern.",
        "What is the observatory access phrase?",
        "Quartz Lantern",
    ),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    records = []
    with httpx.Client(base_url=args.url, timeout=360) as client:
        client.get("/health").raise_for_status()
        forbidden = client.post(
            "/search", json={"user_id": "user-0", "query": "test", "top_k": 1}
        )
        assert forbidden.status_code == 401
        headers = {"X-Api-Key": os.environ["AML_ADAPTER_KEY"]}
        for index, (content, query, expected) in enumerate(CASES):
            user = f"user-{index}"
            body = {
                "request_id": f"request-{index}",
                "user_id": user,
                "session_id": f"session-{index}",
                "messages": [
                    {"role": "user", "content": content, "timestamp": 1704067200000}
                ],
            }
            start = time.monotonic()
            response = client.post("/add", headers=headers, json=body)
            add_seconds = time.monotonic() - start
            assert response.status_code == 200, f"Add returned {response.status_code}"
            assert response.json() == {
                "success": True,
                **{k: v for k, v in body.items() if k != "messages"},
            }
            retry = client.post("/add", headers=headers, json=body)
            assert retry.status_code == 200 and retry.json() == response.json()
            search = {"user_id": user, "query": query, "top_k": 3}
            start = time.monotonic()
            response = client.post("/search", headers=headers, json=search)
            search_seconds = time.monotonic() - start
            assert response.status_code == 200, (
                f"Search returned {response.status_code}"
            )
            hits = response.json()["data"]
            assert 0 < len(hits) <= 3 and len({hit["id"] for hit in hits}) == len(hits)
            assert any(expected in hit["content"] for hit in hits), (
                f"Expected evidence missing for {user}"
            )
            assert all(CASES[1 - index][2] not in hit["content"] for hit in hits)
            empty = client.post(
                "/search", headers=headers, json={**search, "user_id": "unknown"}
            )
            assert empty.status_code == 200 and empty.json() == {"data": []}
            records.append(
                {
                    "user_id": user,
                    "add_s": add_seconds,
                    "search_s": search_seconds,
                    "hits": len(hits),
                    "retrieved_expected_evidence": True,
                }
            )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                "machine": platform.machine(),
                "logical_cpus": os.cpu_count(),
                "cases": records,
            },
            indent=2,
        )
        + "\n"
    )
    print(
        f"Passed {len(records)} Add/Search cases, retry, authentication and user isolation"
    )


if __name__ == "__main__":
    main()
