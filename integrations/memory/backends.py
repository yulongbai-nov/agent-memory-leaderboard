"""Native textual memory backends for the AML HTTP service."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx


class OpenSquilla:
    """Use one native index per user through the isolated OpenSquilla runtime."""

    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.worker = subprocess.Popen(
            [
                os.getenv("OPENSQUILLA_PYTHON", sys.executable),
                "-u",
                str(Path(__file__).with_name("opensquilla_worker.py")),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        try:
            self.request(
                "initialize",
                db_path=str(root / "memory.sqlite"),
                embedding_model=os.getenv(
                    "OPENSQUILLA_EMBEDDING", "text-embedding-3-small"
                )
                or None,
            )
        except BaseException:
            self.close()
            raise

    def request(self, op, **payload):
        self.worker.stdin.write(json.dumps({"op": op, **payload}) + "\n")
        self.worker.stdin.flush()
        line = self.worker.stdout.readline()
        if not line:
            raise RuntimeError("OpenSquilla worker exited")
        response = json.loads(line)
        if "error" in response:
            raise RuntimeError(response["error"])
        return response

    def add(self, request_id, turns):
        timestamp = next(
            (turn["timestamp"] for turn in turns if turn["timestamp"] is not None), None
        )
        self.request("index", session_id=request_id, timestamp=timestamp, turns=turns)

    def search(self, query, limit):
        for hit in self.request("search", query=query, k=limit)["hits"]:
            meta = hit["metadata"]
            yield {
                "id": f"{meta['path']}:{meta['start_line']}-{meta['end_line']}",
                "content": hit["content"],
                "score": hit["score"],
            }

    def close(self):
        self.worker.stdin.close()
        try:
            self.worker.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.worker.kill()
            self.worker.wait()
        self.worker.stdout.close()


class OpenViking:
    """Index source turns and commit them to OpenViking's native session memory."""

    def __init__(self, user_scope: str):
        self.root = f"viking://user/{user_scope}/resources/transcripts"
        self.client = httpx.Client(
            base_url=os.getenv("OPENVIKING_BASE_URL", "http://127.0.0.1:1933"),
            headers={
                "X-API-Key": os.environ["OPENVIKING_API_KEY"],
                "X-OpenViking-Account": "aml",
                "X-OpenViking-User": user_scope,
            },
            timeout=300,
        )
        self.request("POST", "/api/v1/fs/mkdir", uri=self.root)

    def request(self, method, path, **payload):
        response = self.client.request(
            method, path, **({"json": payload} if method == "POST" else {})
        )
        response.raise_for_status()
        data = response.json()
        if data.get("status") == "error":
            raise RuntimeError("OpenViking rejected the request")
        return data.get("result")

    def add(self, request_id, turns):
        self.request(
            "POST",
            "/api/v1/content/batch-write",
            root_uri=self.root,
            operations=[
                {
                    "uri": f"{self.root}/{request_id}-{index:04d}.txt",
                    "content": turn["text"],
                }
                for index, turn in enumerate(turns)
            ],
            processing_mode="vectors_only",
            wait=True,
        )
        self.request("POST", "/api/v1/sessions", session_id=request_id)
        self.request(
            "POST",
            f"/api/v1/sessions/{request_id}/messages",
            role="user",
            content="\n".join(turn["text"] for turn in turns),
        )
        result = self.request("POST", f"/api/v1/sessions/{request_id}/commit")
        task_id = result["task_id"]
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            task = self.request("GET", f"/api/v1/tasks/{task_id}")
            if task["status"] == "completed":
                queues = self.request("POST", "/api/v1/system/wait")
                if any(
                    queue.get("error_count") or queue.get("errors")
                    for queue in queues.values()
                ):
                    raise RuntimeError("OpenViking reported indexing errors")
                return
            if task["status"] in {"failed", "cancelled"}:
                raise RuntimeError("OpenViking extraction did not complete")
            time.sleep(1)
        raise TimeoutError("OpenViking extraction timed out")

    def search(self, query, limit):
        result = self.request(
            "POST",
            "/api/v1/search/find",
            query=query,
            target_uri=["viking://~/memories", self.root],
            limit=limit,
            level=2,
            read_content=True,
        )
        resources = [
            hit
            for hit in result.get("resources", [])
            if hit["uri"].startswith(self.root + "/")
        ]
        hits = sorted(
            result.get("memories", []) + resources,
            key=lambda hit: hit.get("score") or 0,
            reverse=True,
        )
        seen = set()
        for hit in hits:
            if (
                hit["uri"] in seen
                or not isinstance(hit.get("content"), str)
                or not hit["content"].strip()
            ):
                continue
            seen.add(hit["uri"])
            item = {"id": hit["uri"], "content": hit["content"]}
            if hit.get("score") is not None:
                item["score"] = hit["score"]
            yield item

    def close(self):
        self.client.close()
