import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REGISTER_PATH = "docs/operations/LOOP-REGISTER.jsonl";
export const VALIDATION_PATH = ".rick/tmp/validation.json";

export function deriveStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const reviewRounds = new Set();
  const findings = [];
  const byTask = {};
  let validationAttempts = 0;
  let validationFailures = 0;

  for (const entry of list) {
    const task = entry?.task ?? "UNSCOPED";
    byTask[task] ??= { events: 0, review_rounds: 0, findings: 0, validation_attempts: 0, validation_failures: 0 };
    byTask[task].events += 1;

    if (entry?.review_round != null) reviewRounds.add(`${entry?.pr ?? "none"}#${entry.review_round}`);
    for (const key of ["finding", "finding_2"]) {
      if (entry?.[key]) {
        findings.push(entry[key]);
        byTask[task].findings += 1;
      }
    }
    const eventName = String(entry?.event ?? entry?.transition ?? entry?.result ?? "").toUpperCase();
    if (eventName.includes("VALIDATION")) {
      validationAttempts += 1;
      byTask[task].validation_attempts += 1;
      if (eventName.includes("FAIL")) {
        validationFailures += 1;
        byTask[task].validation_failures += 1;
      }
    }
  }

  for (const task of Object.keys(byTask)) {
    const rounds = new Set(list.filter((entry) => (entry?.task ?? "UNSCOPED") === task && entry?.review_round != null).map((entry) => `${entry?.pr ?? "none"}#${entry.review_round}`));
    byTask[task].review_rounds = rounds.size;
  }

  return {
    derived: true,
    source_of_truth: REGISTER_PATH,
    events: list.length,
    review_rounds: reviewRounds.size,
    findings: findings.length,
    distinct_finding_classes: [...new Set(findings)].sort(),
    validation_attempts: validationAttempts,
    validation_failures: validationFailures,
    by_task: byTask,
  };
}

function main() {
  const entries = [];
  let invalidLines = 0;
  if (existsSync(REGISTER_PATH)) {
    for (const line of readFileSync(REGISTER_PATH, "utf8").split(/\r?\n/).filter(Boolean)) {
      try { entries.push(JSON.parse(line)); } catch { invalidLines += 1; }
    }
  }
  const stats = deriveStats(entries);
  const validation = existsSync(VALIDATION_PATH) ? JSON.parse(readFileSync(VALIDATION_PATH, "utf8")) : null;
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    ...stats,
    invalid_register_lines: invalidLines,
    current_validation: validation ? {
      task: validation.task ?? null,
      head_sha: validation.head_sha ?? null,
      ac_total: validation.spec_anchored_check?.total ?? null,
      ac_proved: validation.spec_anchored_check?.proved ?? null,
      sensor_injected: validation.sensor?.injected ?? null,
      sensor_killed: validation.sensor?.killed ?? null,
      sensor_survived: validation.sensor?.survived ?? null,
      result: validation.result ?? null,
    } : null,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
