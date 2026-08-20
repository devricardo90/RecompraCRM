/**
 * The single place the application decides what "the business day" means.
 *
 * The SDD requires dates "exibidas no fuso do negócio" but never names that
 * timezone. TASK-04 and TASK-06 deferred showing dates for exactly that reason;
 * TASK-11 could not, because a history is made of dates. So the timezone is an
 * explicit, recorded assumption (TASK-11 spec, A3) rather than a fact, and it
 * lives here alone so it can be changed in one edit.
 */
export const BUSINESS_TIME_ZONE = "America/Sao_Paulo";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const HAS_EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/** Minutes to add to a UTC instant to get the wall clock in the zone. */
function zoneOffsetMinutes(instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));

  const at = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = at("hour") === 24 ? 0 : at("hour");
  const asIfUtc = Date.UTC(at("year"), at("month") - 1, at("day"), hour, at("minute"), at("second"));
  return (asIfUtc - instantMs) / 60_000;
}

/**
 * Converts a wall-clock reading in the business timezone into the UTC instant
 * it denotes.
 *
 * A wall clock does not always denote exactly one instant, and both edge cases
 * are real for São Paulo, which observed DST until 2019 while the sales API
 * accepts backdated values:
 *
 *   gap     - the reading never happened (clocks sprang forward). Resolved by
 *             moving forward by the gap, which keeps distinct inputs distinct;
 *             clamping them all to the first valid instant would collapse
 *             different sales onto one instant and destroy their ordering.
 *   overlap - the reading happened twice (clocks fell back). Resolved to the
 *             first occurrence.
 */
export function businessWallClockToUtc(wallClockAsUtcMs: number): number {
  const firstOffset = zoneOffsetMinutes(wallClockAsUtcMs);
  const firstCandidate = wallClockAsUtcMs - firstOffset * 60_000;
  const secondOffset = zoneOffsetMinutes(firstCandidate);
  const secondCandidate = wallClockAsUtcMs - secondOffset * 60_000;

  // A candidate is real when reading it back in the zone reproduces the wall
  // clock we were asked for.
  const reproduces = (candidate: number) =>
    candidate + zoneOffsetMinutes(candidate) * 60_000 === wallClockAsUtcMs;

  const valid = [...new Set([firstCandidate, secondCandidate])].filter(reproduces);

  if (valid.length === 1) return valid[0];
  if (valid.length > 1) return Math.min(...valid); // overlap: first occurrence
  return Math.max(firstCandidate, secondCandidate); // gap: move forward
}

export class BusinessDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessDateError";
  }
}

/**
 * Interprets a caller-supplied date string.
 *
 * Replacing only the formatter would have been worse than doing nothing:
 * `new Date("2026-08-20")` is midnight UTC, which renders as 19/08/2026 in São
 * Paulo, so a valid caller-supplied day would have shifted backwards. Anything
 * without an explicit offset is therefore anchored to the business timezone
 * here, at the point of interpretation.
 */
export function parseBusinessDateInput(value: string): Date {
  const trimmed = value.trim();

  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    const [, year, month, day] = dateOnly.map(Number);
    assertRealCalendarDate(year, month, day);
    return new Date(businessWallClockToUtc(Date.UTC(year, month - 1, day)));
  }

  if (!HAS_EXPLICIT_OFFSET.test(trimmed)) {
    const local = LOCAL_DATE_TIME.exec(trimmed);
    if (!local) {
      throw new BusinessDateError("Informe uma data de venda válida no formato AAAA-MM-DD.");
    }
    const [, year, month, day, hour, minute] = local.map(Number);
    const second = Number(local[6] ?? 0);
    const millisecond = Number((local[7] ?? "0").padEnd(3, "0"));
    assertRealCalendarDate(year, month, day);
    if (hour > 23 || minute > 59 || second > 59) {
      throw new BusinessDateError("Informe uma hora de venda válida.");
    }
    return new Date(
      businessWallClockToUtc(Date.UTC(year, month - 1, day, hour, minute, second, millisecond)),
    );
  }

  // Explicit offset: the caller already pinned the instant. Every form the
  // existing parser accepts counts -- Z, +HH:MM, -HH:MM and the compact
  // +HHMM/-HHMM -- and none may be reinterpreted as business-local time.
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new BusinessDateError("Informe uma data de venda válida.");
  }
  return parsed;
}

function assertRealCalendarDate(year: number, month: number, day: number) {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new BusinessDateError("Informe uma data de venda que exista no calendário.");
  }
}

/** Renders an instant as the calendar day it falls on in the business timezone. */
export function formatBusinessDate(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return "—";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BUSINESS_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(instant);
}
