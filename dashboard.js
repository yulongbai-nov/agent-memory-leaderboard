"use strict";

const names = {
  "agent-memory-lab": "Agent Memory Lab", naive: "BM25", opensquilla: "OpenSquilla", openviking: "OpenViking",
  cognee: "Cognee", everos: "EverOS", fraise: "Fraise", graphiti: "Graphiti",
  hindsight: "Hindsight", langmem: "LangMem", mem0: "Mem0", memos: "MemOS",
};
const byId = (id) => document.getElementById(id);
const nameOf = (id) => names[id] || id;
function number(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  if (value > 0 && value < 10 ** -digits) return "<" + 10 ** -digits;
  return value.toLocaleString("en", { maximumFractionDigits: digits });
}
const coverage = (summary) => summary ? summary.usage_coverage ?? "full" : "—";
const found = (summary) => summary?.attribution?.n ? summary.attribution.found : null;
const ratio = (value) => Number.isFinite(value) ? number(value * 100, 1) + "%" : "—";
const pair = (values) => ["p50_s", "p95_s"].map((key) => number(values?.[key])).join(" / ");
const correct = (entry) => entry.questions?.filter((row) => row.judge_correct).length;
const peak = (entry) => entry.runtime?.sampled_peak_kib == null ? null : entry.runtime.sampled_peak_kib / 1024;
const score = (entry) => entry.questions ? correct(entry) + "/" + entry.questions.length : "—";

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content instanceof Node) element.append(content);
  else if (content != null) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function link(text, url) {
  const anchor = node("a", text);
  anchor.href = url;
  return anchor;
}

const tableSorts = new WeakMap();
const textOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const latencyKey = (value) => [value?.p50_s, value?.p95_s];

function compareKeys(left, right, direction) {
  const a = Array.isArray(left) ? left : [left];
  const b = Array.isArray(right) ? right : [right];
  for (let index = 0; index < a.length; index++) {
    const x = a[index];
    const y = b[index];
    if (x == null || y == null) {
      if (x != null) return -1;
      if (y != null) return 1;
      continue;
    }
    const order = typeof x === "number" && typeof y === "number" ? x - y : textOrder.compare(x, y);
    if (order) return direction * order;
  }
  return 0;
}

function appendTable(table, columns, rows, defaultSort = null) {
  let sort = tableSorts.get(table) ?? defaultSort;
  const head = table.createTHead().insertRow();
  const body = table.createTBody();

  function showRows() {
    const ordered = sort ? [...rows].sort((a, b) =>
      compareKeys(a.keys[sort.column], b.keys[sort.column], sort.direction)) : rows;
    body.replaceChildren(...ordered.map(({ cells }) => {
      const row = node("tr");
      const header = node("th", cells[0]);
      header.scope = "row";
      row.append(header, ...cells.slice(1).map((value) => node("td", value)));
      return row;
    }));
    Array.from(head.cells).forEach((header, index) => {
      const active = sort?.column === index;
      const direction = active && sort.direction === -1 ? "descending" : "ascending";
      if (active) header.setAttribute("aria-sort", direction);
      else header.removeAttribute("aria-sort");
      header.querySelector(".sort-arrow").textContent = active ? (sort.direction === 1 ? "▲" : "▼") : "↕";
      header.querySelector("button").title = "Sort " + (active && sort.direction === 1 ? "descending" : "ascending");
    });
  }

  columns.forEach((column, index) => {
    const cell = node("th");
    cell.scope = "col";
    const button = node("button", column, "sort-column");
    button.type = "button";
    const arrow = node("span", null, "sort-arrow");
    arrow.setAttribute("aria-hidden", "true");
    button.append(arrow);
    button.addEventListener("click", () => {
      sort = { column: index, direction: sort?.column === index ? -sort.direction : 1 };
      tableSorts.set(table, sort);
      showRows();
    });
    cell.append(button);
    head.append(cell);
  });
  showRows();
}

function chart(title, entries, valueOf, format, fixedMax) {
  const box = node("div", null, "chart");
  box.append(node("h3", title));
  const values = entries.map(valueOf);
  const max = fixedMax ?? Math.max(1, ...values.filter(Number.isFinite));
  entries.forEach((entry, index) => {
    const value = values[index];
    const row = node("div", null, "chart-row");
    const track = node("span", null, "track");
    track.setAttribute("aria-hidden", "true");
    if (Number.isFinite(value)) {
      const fill = node("span", null, "fill");
      fill.style.width = 100 * value / max + "%";
      track.append(fill);
    }
    row.append(node("span", entry.label ?? nameOf(entry.system)), track, node("span", format(entry), "chart-value"));
    box.append(row);
  });
  return box;
}

function evidence(entry) {
  const details = node("details");
  details.append(node("summary", nameOf(entry.system) + " · " + (entry.questions ? score(entry) : entry.status)));
  const body = node("div", null, "details-body");
  body.append(link("GitHub Actions job", entry.url));
  if (entry.failure) body.append(node("p", entry.failure));
  if (entry.ingestion?.length) {
    const stats = entry.ingestion[0].system_stats;
    if (stats && Object.keys(stats).length) {
      body.append(node("p", "Index · " + Object.entries(stats).map(([key, value]) =>
        key.replaceAll("_", " ") + " " + value).join(" · ")));
    }
  }
  for (const row of entry.questions ?? []) {
    const question = node("article", null, "question");
    question.append(node("h3", row.question));
    question.append(
      node("p", row.question_id + " · " + (row.category ?? "Uncategorized") + " · " + (row.judge_correct ? "Correct" : "Incorrect")),
      node("p", "Reference answer · " + (row.gold_answer ?? "—")),
      node("p", "Predicted answer · " + (row.predicted_answer ?? "—")),
      node("p", "Judge · " + (row.judge_reasoning ?? "—")),
      node("p", "Evidence sessions · " + (row.evidence_session_ids?.join(", ") || "—")),
      node("p", "Retrieved sessions · " + (row.retrieved_session_ids?.join(", ") || "—")),
      node("p", "Search " + number(row.search_s) + " s · answer " + number(row.answer_s) + " s · " + number(row.num_hits, 0) + " hits")
    );
    body.append(question);
  }
  details.append(body);
  return details;
}

const activeSystems = ["naive", "agent-memory-lab", "openviking", "everos"];
const activeEntries = (entries) => activeSystems.map((name) => entries.find((entry) => entry.system === name)).filter(Boolean);

function renderMatched(entries) {
  byId("completion").textContent = entries.filter((entry) => entry.questions).length + "/" + entries.length + " completed";
  byId("protocol").append(" · GPT-6 Luna reader and judge · text-embedding-3-small where used");
  byId("charts").append(
    chart("Judged answers", entries, correct, score, 3),
    chart("Median search time", entries, (entry) => entry.summary?.search_latency?.p50_s,
      (entry) => entry.summary ? number(entry.summary.search_latency?.p50_s, 3) + " s" : "—"),
    chart("Sampled peak RAM", entries, peak, (entry) => peak(entry) == null ? "—" : number(peak(entry), 0) + " MiB")
  );
  appendTable(byId("matched-table"), [
    "Candidate", "Status", "Correct", "Evidence found", "Hits/query", "Search p50 / p95 s",
    "Answer p50 / p95 s", "Ingest s", "Wall s", "Peak MiB", "RAM samples (dropped)",
    "Reader in / out per question", "Memory tokens", "Token coverage", "Runner", "Version",
  ], entries.map((entry) => {
    const summary = entry.summary;
    const runtime = entry.runtime;
    const runner = runtime?.runner;
    const cells = [
      link(nameOf(entry.system), entry.url), entry.status, score(entry), ratio(found(summary)),
      number(summary?.hits_per_query), pair(summary?.search_latency), pair(summary?.answer_latency),
      number(summary?.ingest?.total_s), number(runtime?.wall_seconds), number(peak(entry), 0),
      runtime ? runtime.memory_samples + " (" + runtime.dropped_memory_samples + ")" : "—",
      [summary?.tokens?.input_per_question, summary?.tokens?.output_per_question].map((value) => number(value, 0)).join(" / "),
      number(summary?.memory_tokens_total, 0), coverage(summary),
      runner ? [runner.cpu, runner.logical_cpus + " vCPU", number(runner.memory_kib / 1024 ** 2, 1) + " GiB", runner.image_version].filter(Boolean).join(" · ") : "—",
      summary?.system_version ?? "—",
    ];
    return { cells, keys: [
      nameOf(entry.system), entry.status, correct(entry), found(summary), summary?.hits_per_query,
      latencyKey(summary?.search_latency), latencyKey(summary?.answer_latency),
      summary?.ingest?.total_s, runtime?.wall_seconds, peak(entry),
      [runtime?.memory_samples, runtime?.dropped_memory_samples],
      [summary?.tokens?.input_per_question, summary?.tokens?.output_per_question],
      summary?.memory_tokens_total, summary ? coverage(summary) : null,
      [runner?.cpu, runner?.logical_cpus, runner?.memory_kib, runner?.image_version],
      summary?.system_version,
    ] };
  }));
  byId("evidence").append(...entries.map(evidence));
}

function renderArchive(cohorts) {
  const select = byId("cohort");
  const table = byId("archive-table");
  cohorts.forEach((cohort, index) => {
    const option = node("option", cohort.label);
    option.value = index;
    select.append(option);
  });
  function show() {
    table.tHead?.remove();
    table.tBodies[0]?.remove();
    const cohort = cohorts[Number(select.value)];
    const ranked = [...cohort.runs].sort((a, b) => (b.summary.judge_accuracy ?? -1) - (a.summary.judge_accuracy ?? -1));
    byId("archive-chart").replaceChildren(chart("Judged accuracy", ranked.map(({ summary }) => ({
      system: summary.system,
      label: nameOf(summary.system) + (summary.system_version ? " " + summary.system_version : ""),
      accuracy: summary.judge_accuracy,
    })), (entry) => entry.accuracy, (entry) => ratio(entry.accuracy), 1));
    byId("archive-models").textContent = "Reader " + cohort.model + " · Judge " + cohort.judge;
    appendTable(table, [
      "Candidate", "Accuracy", "Questions", "Errors", "Evidence found", "Hits/query",
      "Search p50 / p95 s", "Answer p50 / p95 s", "Ingest s", "Memory tokens", "Token coverage",
    ], ranked.map(({ summary, url }) => {
      const name = nameOf(summary.system) + (summary.system_version ? " " + summary.system_version : "");
      return { cells: [
        link(name, url), ratio(summary.judge_accuracy), number(summary.num_questions, 0),
        number(summary.errors, 0), ratio(found(summary)), number(summary.hits_per_query),
        pair(summary.search_latency), pair(summary.answer_latency), number(summary.ingest?.total_s),
        number(summary.memory_tokens_total, 0), coverage(summary),
      ], keys: [
        name, summary.judge_accuracy, summary.num_questions, summary.errors,
        found(summary), summary.hits_per_query, latencyKey(summary.search_latency),
        latencyKey(summary.answer_latency), summary.ingest?.total_s, summary.memory_tokens_total,
        coverage(summary),
      ] };
    }), { column: 1, direction: -1 });
  }
  select.addEventListener("change", show);
  show();
}

function renderQuestionBanks(bank) {
  const count = bank.suites.reduce((total, suite) => total + suite.questions.length, 0);
  byId("bank-caption").textContent = count + " questions across " + bank.suites.length + " suites";
  appendTable(byId("bank-table"), ["Suite", "Track", "Selected", "Eligible", "Status", "Protocol"], bank.suites.map((suite) => ({
    cells: [
      link(suite.label, suite.source), suite.track, number(suite.questions.length, 0),
      number(suite.eligible_questions, 0), suite.status, suite.note,
    ],
    keys: [
      suite.label, suite.track, suite.questions.length, suite.eligible_questions,
      suite.status, suite.note,
    ],
  })));
}

function renderCoding(rows) {
  const source = rows[0];
  byId("coding-caption").textContent = source.scorable + " scored of " + source.target_rows + " released task rows";
  byId("coding-charts").append(chart("Hit rate at 10", rows, (row) => row.hit_at_10, (row) => ratio(row.hit_at_10), 1));
  appendTable(byId("coding-table"), ["Candidate", "Hit@1", "Hit@10", "Recall@10", "MRR@10", "Median search ms", "Ingest s"], rows.map((row) => {
    const metrics = [row.hit_at_1, row.hit_at_10, row.recall_at_10, row.mrr_at_10, row.search_p50_s * 1000, row.ingest_s];
    return {
      cells: [link(nameOf(row.system), row.url), ...metrics.slice(0, 3).map(ratio), ...metrics.slice(3).map((value) => number(value, 3))],
      keys: [nameOf(row.system), ...metrics],
    };
  }));
}

function renderRefined(entries) {
  entries = activeEntries(entries);
  const completed = entries.filter((entry) => entry.status === "Completed").length;
  byId("refined-caption").textContent = completed + "/" + entries.length + " candidates completed";
  appendTable(byId("refined-table"), ["Candidate", "Status", "Correct", "Evidence found", "Search p50 s", "Ingest s", "Wall s", "Peak MiB", "Runner"], entries.map((entry) => {
    const summary = entry.summary;
    const search = summary?.search_latency?.p50_s;
    const ingest = summary?.ingest?.total_s;
    const wall = entry.runtime?.wall_seconds;
    const cpu = entry.runtime?.runner;
    const correct = summary?.judge_accuracy * summary?.num_questions;
    return {
      cells: [link(nameOf(entry.system), entry.url), entry.status, summary ? number(correct, 0) + "/" + summary.num_questions : "—",
        ratio(found(summary)), number(search, 3), number(ingest), number(wall), number(peak(entry), 0),
        cpu ? cpu.cpu + " · " + cpu.logical_cpus + " vCPU" : "—"],
      keys: [nameOf(entry.system), entry.status, Number.isFinite(correct) ? correct : null, found(summary),
        search, ingest, wall, peak(entry), cpu?.cpu],
    };
  }));
}

async function readResults(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Results are unavailable.");
  return response.json();
}

Promise.all([readResults("results.json?v=4"), readResults("archive.json")]).then(([results, archive]) => {
  renderMatched(activeEntries(results.matched));
  byId("smoke-archive").append(...results.matched.filter((entry) => !activeSystems.includes(entry.system)).map(evidence));
  byId("protocol").append(" · ", link("Workflow run", results.run_url));
  renderArchive(archive);
  byId("analysis").append(...results.analysis.map((paragraph) => node("p", paragraph)));
}).catch(() => {
  byId("completion").textContent = "Could not load results";
});


readResults("question-banks.json?v=2").then(renderQuestionBanks).catch(() => {
  byId("bank-caption").textContent = "Could not load question banks";
});


readResults("swe-retrieval.json").then(renderCoding).catch(() => {
  byId("coding-caption").textContent = "Coding measurements unavailable";
});

readResults("locomo-refined.json?v=4").then(renderRefined).catch(() => {
  byId("refined-caption").textContent = "Rerun results pending";
});
