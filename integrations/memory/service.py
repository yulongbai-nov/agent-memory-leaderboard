"""Serve the AML Textual Add and Search API on loopback for benchmark runs."""

import argparse
import hashlib
import hmac
import itertools
import json
import math
import os
import signal
import uuid
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from backends import OpenSquilla, OpenViking


def required_text(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Expected non-empty text")
    return value


def fingerprint(*values):
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def format_turn(message, index):
    role = message["role"]
    content = required_text(message["content"])
    timestamp = message.get("timestamp")
    if role not in ("user", "assistant"):
        raise ValueError("Invalid role")
    prefix = ""
    if timestamp is not None:
        if type(timestamp) is not int:
            raise ValueError("Timestamp must be an integer in milliseconds")
        date = datetime.fromtimestamp(timestamp / 1000, tz=UTC)
        prefix = f"[{date.isoformat()}] "
    return {
        "id": str(index),
        "role": role,
        "text": f"{prefix}{role}: {content}",
        "timestamp": timestamp / 1000 if timestamp is not None else None,
    }


class MemoryServer(HTTPServer):
    def __init__(self, port, factory, key):
        self.factory = factory
        self.key = key.encode()
        self.users = {}
        self.writes = {}
        super().__init__(("127.0.0.1", port), Handler)

    def add(self, body):
        ids = {
            key: required_text(body[key])
            for key in ("request_id", "user_id", "session_id")
        }
        messages = body["messages"]
        if not isinstance(messages, list) or not messages:
            raise ValueError("Expected a non-empty message array")
        turns = [format_turn(message, index) for index, message in enumerate(messages)]
        user = ids["user_id"]
        request = ids["request_id"]
        digest = fingerprint(ids, messages)
        previous = self.writes.get((user, request))
        if previous is not None and previous != digest:
            return 409, {"error": "Conflicting request_id"}
        if previous is None:
            if user not in self.users:
                self.users[user] = self.factory("aml-" + fingerprint(user)[:32])
            self.users[user].add("req-" + fingerprint(user, request)[:32], turns)
            self.writes[user, request] = digest
        return 200, {"success": True, **ids}

    def search(self, body):
        user = required_text(body["user_id"])
        query = required_text(body["query"])
        limit = body["top_k"]
        if type(limit) is not int or limit < 1:
            raise ValueError("top_k must be a positive integer")
        if user not in self.users:
            return 200, {"data": []}
        results = list(itertools.islice(self.users[user].search(query, limit), limit))
        for result in results:
            if result.get("score") is not None and not math.isfinite(result["score"]):
                del result["score"]
        return 200, {"data": results}

    def server_close(self):
        try:
            for backend in self.users.values():
                backend.close()
        finally:
            super().server_close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def reply(self, status, result):
        data = json.dumps(result, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"status": "ok"})
        else:
            self.reply(404, {"error": "Unknown endpoint"})

    def do_POST(self):
        routes = {"/add": self.server.add, "/search": self.server.search}
        if self.path not in routes:
            self.reply(404, {"error": "Unknown endpoint"})
            return
        key = self.headers.get("X-Api-Key", "").encode()
        if not hmac.compare_digest(key, self.server.key):
            self.reply(401, {"error": "Invalid API key"})
            return
        try:
            size = int(self.headers["Content-Length"])
            if size < 1:
                raise ValueError("Empty request")
            body = json.loads(self.rfile.read(size))
        except (TypeError, ValueError):
            self.reply(400, {"error": "Invalid JSON request"})
            return
        try:
            status, result = routes[self.path](body)
        except (KeyError, TypeError, ValueError, OverflowError):
            status, result = 422, {"error": "Invalid Textual request"}
        except Exception as exc:  # noqa: BLE001
            # Report the exception class without logging benchmark content or credentials.
            print(f"Backend error ({type(exc).__name__})", flush=True)
            status, result = 502, {"error": "Memory backend failed"}
        self.reply(status, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backend", choices=["opensquilla", "openviking"])
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--state-dir", type=Path, required=True)
    args = parser.parse_args()
    key = required_text(os.environ.get("AML_ADAPTER_KEY"))
    # A new service process starts a new benchmark run and owns its state.
    args.state_dir.mkdir(parents=True, exist_ok=False)
    run_id = uuid.uuid4().hex[:12]

    def factory(scope):
        scope = run_id + "-" + scope
        if args.backend == "opensquilla":
            return OpenSquilla(args.state_dir / scope)
        return OpenViking(scope)

    def stop(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    with MemoryServer(args.port, factory, key) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
