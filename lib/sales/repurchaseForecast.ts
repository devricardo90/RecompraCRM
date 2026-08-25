// Explicit .ts extension so the deterministic harness can import this module
// directly under node --experimental-strip-types; tsconfig allows it.
import { businessDayNumber } from "../format/businessDate.ts";

/**
 * TASK-12 reads the repurchase forecast; it never computes one.
 *
 * `SaleItem.expectedRepurchaseAt` is owned by the TASK-09 PostgreSQL triggers
 * (ARCH-01 Option A). Nothing here reconstructs the formula, and nothing here
 * writes the column: this module only decides which bucket a stored value falls
 * into.
 */

export const UPCOMING_WINDOW_DAYS = 7;

export type RepurchaseBucket = "overdue" | "today" | "upcoming";

export type RepurchaseCounts = Record<RepurchaseBucket, number>;

export type ForecastRow = {
  saleItemId: number;
  expectedRepurchaseAt: Date | string | null;
};

/**
 * Buckets are decided on business days, never on instants, and always against a
 * single reference instant supplied by the caller.
 *
 * `null` is not classifiable rather than overdue: a legacy row whose forecast
 * could not be represented is unknown, and presenting unknown as "overdue" would
 * invent a contact the data does not support.
 *
 * Returns `null` for anything outside the window so a caller cannot accidentally
 * treat "not shown" as a fourth bucket.
 */
export function classifyRepurchase(
  expectedRepurchaseAt: Date | string | null | undefined,
  reference: Date | string | number,
): RepurchaseBucket | null {
  if (expectedRepurchaseAt === null || expectedRepurchaseAt === undefined) return null;
  const forecast = expectedRepurchaseAt instanceof Date ? expectedRepurchaseAt : new Date(expectedRepurchaseAt);
  if (Number.isNaN(forecast.getTime())) return null;

  const today = businessDayNumber(reference);
  const day = businessDayNumber(forecast);

  if (day < today) return "overdue";
  if (day === today) return "today";
  // Closed upper bound: "the next seven days" starts tomorrow and includes day
  // seven, so today is never double-counted and day eight is out.
  if (day <= today + UPCOMING_WINDOW_DAYS) return "upcoming";
  return null;
}

const BUCKET_ORDER: RepurchaseBucket[] = ["overdue", "today", "upcoming"];

/**
 * Total order within a bucket.
 *
 * `(saleId, productId)` is not unique, so two rows can carry exactly the same
 * forecast. Without the id tie-break their relative order would be left to the
 * query plan and the list could reshuffle between identical reads.
 */
export function compareForecastRows(left: ForecastRow, right: ForecastRow): number {
  const leftMs = left.expectedRepurchaseAt ? new Date(left.expectedRepurchaseAt).getTime() : 0;
  const rightMs = right.expectedRepurchaseAt ? new Date(right.expectedRepurchaseAt).getTime() : 0;
  return leftMs - rightMs || left.saleItemId - right.saleItemId;
}

export function emptyCounts(): RepurchaseCounts {
  return { overdue: 0, today: 0, upcoming: 0 };
}

/**
 * Buckets and counts are produced together from one pass, so a summary that
 * disagrees with the list it summarises is not representable.
 */
export function buildRepurchaseView<T extends ForecastRow>(
  rows: T[],
  reference: Date | string | number,
): { items: (T & { bucket: RepurchaseBucket })[]; counts: RepurchaseCounts } {
  const counts = emptyCounts();
  const classified: (T & { bucket: RepurchaseBucket })[] = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const bucket = classifyRepurchase(row?.expectedRepurchaseAt, reference);
    if (!bucket) continue;
    counts[bucket] += 1;
    classified.push({ ...row, bucket });
  }

  classified.sort(
    (left, right) =>
      BUCKET_ORDER.indexOf(left.bucket) - BUCKET_ORDER.indexOf(right.bucket)
      || compareForecastRows(left, right),
  );

  return { items: classified, counts };
}
