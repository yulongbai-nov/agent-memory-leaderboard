"use strict";

const names = {
  naive: "BM25", opensquilla: "OpenSquilla", openviking: "OpenViking",
  cognee: "Cognee", everos: "EverOS", fraise: "Fraise", graphiti: "Graphiti",
  hindsight: "Hindsight", langmem: "LangMem", mem0: "Mem0", memos: "MemOS",
};
const byId = (id) => document.getElementById(id);
const nameOf = (id) => names[id] || id;
const number = (value, digits = 2) =>
  Number.isFinite(value) ? value.toLocaleString("en", { maximumFractionDigits: digits }) : "—";
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

function appendTable(table, columns, rows) {
  const head = table.createTHead().insertRow();
  for (const column of columns) {
    const cell = node("th", column);
    cell.scope = "col";
    head.append(cell);
  }
  const body = table.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    const header = node("th", values[0]);
    header.scope = "row";
    row.append(header);
    for (const value of values.slice(1)) row.append(node("td", value));
  }
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
    return [
      link(nameOf(entry.system), entry.url), entry.status, score(entry), ratio(found(summary)),
      number(summary?.hits_per_query), pair(summary?.search_latency), pair(summary?.answer_latency),
      number(summary?.ingest?.total_s), number(runtime?.wall_seconds), number(peak(entry), 0),
      runtime ? runtime.memory_samples + " (" + runtime.dropped_memory_samples + ")" : "—",
      [summary?.tokens?.input_per_question, summary?.tokens?.output_per_question].map((value) => number(value, 0)).join(" / "),
      number(summary?.memory_tokens_total, 0), coverage(summary),
      runner ? [runner.cpu, runner.logical_cpus + " vCPU", number(runner.memory_kib / 1024 ** 2, 1) + " GiB", runner.image_version].filter(Boolean).join(" · ") : "—",
      summary?.system_version ?? "—",
    ];
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
    ], ranked.map(({ summary, url }) => [
      link(nameOf(summary.system) + (summary.system_version ? " " + summary.system_version : ""), url),
      ratio(summary.judge_accuracy), number(summary.num_questions, 0), number(summary.errors, 0),
      ratio(found(summary)), number(summary.hits_per_query), pair(summary.search_latency),
      pair(summary.answer_latency), number(summary.ingest?.total_s), number(summary.memory_tokens_total, 0),
      coverage(summary),
    ]));
  }
  select.addEventListener("change", show);
  show();
}

async function readResults(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Results are unavailable.");
  return response.json();
}

Promise.all([readResults("results.json"), readResults("archive.json")]).then(([results, archive]) => {
  renderMatched(results.matched);
  byId("protocol").append(" · ", link("Workflow run", results.run_url));
  renderArchive(archive);
  byId("analysis").append(...results.analysis.map((paragraph) => node("p", paragraph)));
}).catch(() => {
  byId("completion").textContent = "Could not load results";
});
