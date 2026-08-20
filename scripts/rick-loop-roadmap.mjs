const RESOLVED_STATUSES = new Set([
  "COMPLETED",
  "COMPLETE",
  "DONE",
  "CLOSED",
  "RESOLVED",
  "DECIDED",
]);

function normalizeStatus(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function parseReferenceList(value) {
  const refs = new Set();
  const source = String(value ?? "");

  for (const match of source.matchAll(/(TASK|ARCH)-(\d+)\.\.(?:TASK|ARCH)-(\d+)/g)) {
    const [, prefix, startRaw, endRaw] = match;
    const start = Number(startRaw);
    const end = Number(endRaw);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) continue;
    const width = Math.max(startRaw.length, endRaw.length);
    for (let value = start; value <= end; value += 1) {
      refs.add(`${prefix}-${String(value).padStart(width, "0")}`);
    }
  }

  for (const match of source.matchAll(/(?:TASK|ARCH)-\d+/g)) refs.add(match[0]);
  return [...refs];
}

export function parseRoadmapPlan(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const entries = [];
  let current = null;

  for (const line of normalized.split("\n")) {
    const item = line.match(/^- \[([ xX])\] ((?:TASK|ARCH)-\d+)\s+—\s+(.+)$/);
    if (item) {
      current = {
        id: item[2],
        kind: item[2].startsWith("TASK-") ? "TASK" : "ARCH",
        title: item[3].trim(),
        checked: item[1].toLowerCase() === "x",
        status: null,
        blocking: null,
        depends_on: [],
        blocked_by: [],
      };
      entries.push(current);
      continue;
    }

    if (!current) continue;
    const meta = line.match(/^\s{2,}-\s+([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!meta) continue;
    const [, key, rawValue] = meta;

    if (key === "depends_on") current.depends_on = parseReferenceList(rawValue);
    else if (key === "blocked_by") current.blocked_by = parseReferenceList(rawValue);
    else if (key === "status") current.status = rawValue.trim();
    else if (key === "blocking") {
      const value = rawValue.trim().toLowerCase();
      current.blocking = value === "true" ? true : value === "false" ? false : null;
    }
  }

  return { entries };
}

export function isRoadmapEntryResolved(entry) {
  if (!entry) return false;
  return Boolean(entry.checked || RESOLVED_STATUSES.has(normalizeStatus(entry.status)));
}

export function resolveNextEligibleTask(plan) {
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const skipped = [];

  for (const task of entries) {
    if (task.kind !== "TASK" || isRoadmapEntryResolved(task)) continue;

    const references = [...new Set([...(task.depends_on ?? []), ...(task.blocked_by ?? [])])];
    const blockers = references
      .filter((reference) => !isRoadmapEntryResolved(byId.get(reference)))
      .map((reference) => ({
        reference,
        missing: !byId.has(reference),
        kind: byId.get(reference)?.kind ?? null,
        status: byId.get(reference)?.status ?? null,
        checked: byId.get(reference)?.checked ?? false,
      }));

    if (blockers.length === 0) {
      return {
        task: task.id,
        reason: "ELIGIBLE_TASK_FOUND",
        skipped,
      };
    }

    skipped.push({ task: task.id, blockers });
  }

  return {
    task: null,
    reason: entries.some((entry) => entry.kind === "TASK" && !isRoadmapEntryResolved(entry))
      ? "NO_ELIGIBLE_TASK"
      : "ROADMAP_COMPLETE",
    skipped,
  };
}
