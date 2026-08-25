import { strict as assert } from "node:assert";

// Drives the production classifier and the production date module, not copies of
// them -- the rule TASK-10 established after its harness was found testing a
// private reimplementation.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  console.error("Repurchase forecast tests: FAIL");
  console.error(`Node ${process.versions.node} cannot import TypeScript directly; needs Node >= 24.`);
  process.exit(1);
}

const {
  UPCOMING_WINDOW_DAYS,
  buildRepurchaseView,
  classifyRepurchase,
  compareForecastRows,
} = await import("../lib/sales/repurchaseForecast.ts");
const { businessDayEndUtc, businessDayNumber, parseBusinessDateInput } = await import(
  "../lib/format/businessDate.ts"
);

// A fixed reference so the suite does not depend on the day it runs.
const reference = parseBusinessDateInput("2026-08-25T10:00");
// Date.UTC normalises month overflow and underflow, so offsets may cross month
// boundaries in either direction.
const dayAt = (offset) => {
  const day = new Date(Date.UTC(2026, 7, 25 + offset));
  const month = String(day.getUTCMonth() + 1).padStart(2, "0");
  const date = String(day.getUTCDate()).padStart(2, "0");
  return parseBusinessDateInput(`${day.getUTCFullYear()}-${month}-${date}T09:00`);
};

// --- buckets (AC1, AC2, AC3, AC4) ---
assert.equal(classifyRepurchase(dayAt(-1), reference), "overdue", "AC1: yesterday is overdue");
assert.equal(classifyRepurchase(dayAt(-40), reference), "overdue", "AC18: an old forecast is still overdue");
assert.equal(classifyRepurchase(dayAt(0), reference), "today", "AC2: the same business day is today");
assert.equal(classifyRepurchase(dayAt(1), reference), "upcoming", "AC3: tomorrow is upcoming");
assert.equal(classifyRepurchase(dayAt(UPCOMING_WINDOW_DAYS), reference), "upcoming", "AC4: day seven is included");
assert.equal(classifyRepurchase(dayAt(UPCOMING_WINDOW_DAYS + 1), reference), null, "AC4: day eight is excluded");

// --- null is unknown, never overdue (AC5) ---
assert.equal(classifyRepurchase(null, reference), null, "AC5: null is not classifiable");
assert.equal(classifyRepurchase(undefined, reference), null, "AC5: a missing forecast is not classifiable");
assert.equal(classifyRepurchase("not-a-date", reference), null, "AC5: an unparseable value is not classifiable");

// --- business days, not instants (AC15) ---
const startOfToday = parseBusinessDateInput("2026-08-25T00:01");
const endOfToday = parseBusinessDateInput("2026-08-25T23:59");
assert.equal(classifyRepurchase(startOfToday, reference), "today", "00:01 is today");
assert.equal(classifyRepurchase(endOfToday, reference), "today", "23:59 is today");
assert.equal(
  businessDayNumber(startOfToday),
  businessDayNumber(endOfToday),
  "both ends of a business day share one day number",
);

// --- one bucket only, counts match the lists (AC6, AC7) ---
const rows = [
  { saleItemId: 5, expectedRepurchaseAt: dayAt(1) },
  { saleItemId: 1, expectedRepurchaseAt: dayAt(-3) },
  { saleItemId: 9, expectedRepurchaseAt: dayAt(0) },
  { saleItemId: 7, expectedRepurchaseAt: null },
  { saleItemId: 3, expectedRepurchaseAt: dayAt(UPCOMING_WINDOW_DAYS + 5) },
  { saleItemId: 4, expectedRepurchaseAt: dayAt(UPCOMING_WINDOW_DAYS) },
];
const view = buildRepurchaseView(rows, reference);
assert.deepEqual(view.counts, { overdue: 1, today: 1, upcoming: 2 }, "AC7: counts match the classified set");
assert.equal(view.items.length, 4, "AC5: out-of-window and null rows are absent");
assert.equal(
  view.items.filter((item) => item.saleItemId === 7 || item.saleItemId === 3).length,
  0,
  "AC5: a null forecast and an out-of-window forecast never appear",
);
const seen = new Map();
for (const item of view.items) {
  assert.equal(seen.has(item.saleItemId), false, "AC6: an item may not appear twice");
  seen.set(item.saleItemId, item.bucket);
}
assert.equal(
  view.counts.overdue + view.counts.today + view.counts.upcoming,
  view.items.length,
  "AC7: the summary cannot disagree with the list",
);

// --- deterministic order with the id tie-break (AC8) ---
const tied = [
  { saleItemId: 22, expectedRepurchaseAt: dayAt(2) },
  { saleItemId: 4, expectedRepurchaseAt: dayAt(2) },
  { saleItemId: 13, expectedRepurchaseAt: dayAt(1) },
];
assert.deepEqual(
  buildRepurchaseView(tied, reference).items.map((item) => item.saleItemId),
  [13, 4, 22],
  "AC8: forecast ascending, then saleItemId ascending",
);
assert.equal(
  compareForecastRows({ saleItemId: 4, expectedRepurchaseAt: dayAt(2) }, { saleItemId: 22, expectedRepurchaseAt: dayAt(2) }) < 0,
  true,
  "AC8: equal forecasts fall back to the id",
);
assert.deepEqual(
  buildRepurchaseView(view.items.slice().reverse(), reference).items.map((item) => item.bucket),
  ["overdue", "today", "upcoming", "upcoming"],
  "AC8: buckets are grouped overdue then today then upcoming regardless of input order",
);

// --- one reference instant governs the whole view (AC19) ---
const justBeforeMidnight = parseBusinessDateInput("2026-08-25T23:59");
const justAfterMidnight = parseBusinessDateInput("2026-08-26T00:01");
const seventhFromThe25th = dayAt(UPCOMING_WINDOW_DAYS);
assert.equal(classifyRepurchase(seventhFromThe25th, justBeforeMidnight), "upcoming", "day seven before midnight");
assert.equal(
  classifyRepurchase(seventhFromThe25th, justAfterMidnight),
  "upcoming",
  "the same forecast is still inside the window after midnight, one day closer",
);
assert.equal(
  businessDayNumber(businessDayEndUtc(reference, UPCOMING_WINDOW_DAYS)),
  businessDayNumber(reference) + UPCOMING_WINDOW_DAYS,
  "AC19: the SQL upper bound lands on the seventh business day, derived from the reference",
);
assert.equal(
  businessDayEndUtc(reference, UPCOMING_WINDOW_DAYS).getTime() > seventhFromThe25th.getTime(),
  true,
  "AC4: the bound includes the whole of day seven",
);

// --- an empty set is an empty view, not an error ---
const empty = buildRepurchaseView([], reference);
assert.deepEqual(empty.counts, { overdue: 0, today: 0, upcoming: 0 }, "AC14: zero rows is an empty view");
assert.deepEqual(empty.items, []);
assert.deepEqual(buildRepurchaseView(null, reference).items, [], "a missing row set is not a crash");

console.log("Repurchase forecast projection tests: PASS");
