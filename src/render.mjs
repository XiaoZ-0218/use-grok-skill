// Human-readable rendering for setup reports, reviews, runs, and job status.

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Render the check/setup report.
 * @param {object} report
 * @returns {string}
 */
export function renderSetupReport(report) {
  if (report.ready) {
    return "✅ Grok is ready.\n";
  }
  const lines = ["❌ Grok is not ready.\n"];
  if (!report.node?.available) {
    lines.push(`Node.js: ${report.node?.detail ?? "unavailable"}`);
  }
  if (!report.grok?.available) {
    lines.push(`Grok CLI: ${report.grok?.detail ?? "not found"}`);
  }
  if (report.grok?.available && !report.auth?.loggedIn) {
    lines.push(`Authentication: ${report.auth?.detail ?? "not logged in"}`);
    lines.push("Run \`grok login\` (or the authentication command provided by Grok) and verify with \`grok models\`.");
  }
  return lines.join("\n") + "\n";
}

/**
 * Render a structured critique result as Markdown.
 * @param {object} parsed
 * @param {object} [meta]
 * @returns {string}
 */
export function renderReviewResult(parsed, meta = {}) {
  if (!parsed) {
    return "_(No structured output was produced.)_\n";
  }

  const lines = [];
  lines.push(`**Verdict:** ${parsed.verdict ?? "unknown"}`);
  lines.push("");
  lines.push(parsed.summary ?? "_(No summary provided.)_");
  lines.push("");

  const findings = [...(parsed.findings ?? [])].sort(
    (a, b) =
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  );

  if (findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const f of findings) {
      const loc = f.line_start
        ? `:${f.line_start}${f.line_end && f.line_end !== f.line_start ? `-${f.line_end}` : ""}`
        : "";
      lines.push(`### ${f.severity?.toUpperCase() ?? "UNKNOWN"} — ${f.title ?? "Untitled"}`);
      lines.push(`**File:** \`${f.file ?? "unknown"}\`${loc}  `);
      lines.push(`**Confidence:** ${f.confidence ?? "?"}`);
      lines.push("");
      lines.push(f.body ?? "_(No details.)_");
      if (f.recommendation) {
        lines.push("");
        lines.push(`**Recommendation:** ${f.recommendation}`);
      }
      lines.push("");
    }
  } else {
    lines.push("_No findings._");
    lines.push("");
  }

  if (parsed.next_steps?.length > 0) {
    lines.push("## Next steps");
    lines.push("");
    for (const step of parsed.next_steps) {
      lines.push(`- ${step}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render a plain review output.
 * @param {string} result
 * @param {object} [meta]
 * @returns {string}
 */
export function renderNativeReviewResult(result, meta = {}) {
  return result ?? "_(No output.)_\n";
}

/**
 * Render a task/delegate result.
 * @param {object} parsed
 * @param {object} [meta]
 * @returns {string}
 */
export function renderTaskResult(parsed, meta = {}) {
  return parsed?.rawOutput ?? parsed ?? "_(No output.)_\n";
}

/**
 * Render a status snapshot of multiple jobs.
 * @param {object} report
 * @returns {string}
 */
export function renderStatusReport(report) {
  const { jobs } = report;
  if (!jobs || jobs.length === 0) {
    return "No runs found.\n";
  }

  const lines = ["| Run ID | Kind | Status | Summary | Updated |", "|---|---|---|---|---|"];
  for (const job of jobs) {
    const id = job.id ?? "?";
    const kind = job.kindLabel ?? job.kind ?? "?";
    const status = job.status ?? "?";
    const summary = (job.summary ?? "").slice(0, 40) || "-";
    const updated = job.updatedAt ? new Date(job.updatedAt).toLocaleString() : "-";
    lines.push(`| ${id} | ${kind} | ${status} | ${summary} | ${updated} |`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Render a single job status line.
 * @param {object} job
 * @returns {string}
 */
export function renderJobStatusReport(job) {
  if (!job) {
    return "Run not found.\n";
  }
  const lines = [
    `Run ID: ${job.id}`,
    `Kind: ${job.kindLabel ?? job.kind}`,
    `Status: ${job.status}`,
    `Phase: ${job.phase ?? job.status}`,
  ];
  if (job.summary) lines.push(`Summary: ${job.summary}`);
  if (job.model) lines.push(`Model: ${job.model}`);
  if (job.effort) lines.push(`Effort: ${job.effort}`);
  if (job.errorMessage) lines.push(`Error: ${job.errorMessage}`);
  if (job.createdAt) lines.push(`Created: ${new Date(job.createdAt).toLocaleString()}`);
  if (job.completedAt) lines.push(`Completed: ${new Date(job.completedAt).toLocaleString()}`);
  return lines.join("\n") + "\n";
}

/**
 * Render a stored job result.
 * @param {object} job
 * @param {object} [storedJob]
 * @returns {string}
 */
export function renderStoredJobResult(job, storedJob) {
  if (!job) {
    return "Run not found.\n";
  }
  const output = storedJob?.result?.rawOutput ?? job?.result?.rawOutput ?? job?.rendered ?? "";
  if (!output) {
    return renderJobStatusReport(job);
  }
  return output + "\n";
}

/**
 * Render a cancellation report.
 * @param {object} job
 * @returns {string}
 */
export function renderCancelReport(job) {
  if (!job) {
    return "Run not found.\n";
  }
  return `Stopped run ${job.id} (${job.status}).\n`;
}
