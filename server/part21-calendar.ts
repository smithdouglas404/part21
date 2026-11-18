import { DateTime, IANAZone } from "luxon";

/** A calendar interpretation supplied for display. Approval status is tracked separately and never assumed. */
export type DeclaredCalendar = {
  timezone: string;
  workingWeekdays: number[];
  holidays: string[];
  triggerDay: "exclude" | "include";
  cutoff: "same-local-time" | string;
  ambiguousTime: "earlier" | "later";
  nonexistentTime: "reject" | "next-valid";
  validFrom?: string;
  validThrough?: string;
  approvalStatus: "approved-governed" | "not-approved-for-reliance";
  sourceIds?: string[];
};

export type DeclaredDuration = { amount: number; unit: "calendar-days" | "working-days" };

export const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5] as const;

export function validateDeclaredCalendar(calendar: DeclaredCalendar): DeclaredCalendar {
  if (!calendar) throw new Error("A declared calendar interpretation is required to compute working-day deadlines.");
  if (!IANAZone.isValidZone(calendar.timezone)) throw new Error("An explicit IANA timezone is required.");
  if (!Array.isArray(calendar.workingWeekdays) || !calendar.workingWeekdays.length || calendar.workingWeekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error("Working weekdays must be ISO values 1-7.");
  if (!Array.isArray(calendar.holidays) || calendar.holidays.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) || !DateTime.fromISO(day).isValid)) throw new Error("Holidays must be valid YYYY-MM-DD dates.");
  if (!["exclude", "include"].includes(calendar.triggerDay)) throw new Error("triggerDay must be exclude or include.");
  if (!["earlier", "later"].includes(calendar.ambiguousTime) || !["reject", "next-valid"].includes(calendar.nonexistentTime)) throw new Error("Explicit DST boundary handling is required.");
  if (calendar.cutoff !== "same-local-time" && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?$/.test(calendar.cutoff)) throw new Error("Cutoff must be same-local-time or HH:mm:ss[.SSS].");
  for (const value of [calendar.validFrom, calendar.validThrough]) if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !DateTime.fromISO(value).isValid)) throw new Error("Calendar coverage dates must be valid YYYY-MM-DD.");
  if (calendar.validFrom && calendar.validThrough && calendar.validFrom > calendar.validThrough) throw new Error("Calendar coverage is inverted.");
  return calendar;
}

/**
 * Deterministic due-date arithmetic. Pure: no provider lookup, no holiday
 * discovery, no implied approval. The caller supplies the interpretation.
 */
export function computeDueAt(triggerAt: string, duration: DeclaredDuration, calendar: DeclaredCalendar): { dueAt: string; localDue: string; explanation: string } {
  if (typeof triggerAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(triggerAt)) throw new Error("Trigger must be an ISO timestamp with an explicit offset.");
  const trigger = DateTime.fromISO(triggerAt, { setZone: true });
  if (!trigger.isValid) throw new Error("Trigger timestamp is invalid.");
  validateDeclaredCalendar(calendar);
  if (!Number.isInteger(duration.amount) || duration.amount <= 0 || duration.amount > 36600) throw new Error("A positive bounded duration is required.");
  if (!["calendar-days", "working-days"].includes(duration.unit)) throw new Error("Duration unit must be calendar-days or working-days.");

  const local = trigger.setZone(calendar.timezone);
  let day = local.startOf("day");
  let counted = 0;
  const holidays = new Set(calendar.holidays);
  const covered = (value: DateTime) => {
    const date = value.toISODate()!;
    if (calendar.validFrom && date < calendar.validFrom) throw new Error(`Declared calendar does not cover ${date}.`);
    if (calendar.validThrough && date > calendar.validThrough) throw new Error(`Declared calendar does not cover ${date}.`);
  };
  covered(day);
  if (calendar.triggerDay === "exclude") day = day.plus({ days: 1 });
  let guard = 0;
  while (counted < duration.amount) {
    if (++guard > 40000) throw new Error("Calendar arithmetic exceeded a bounded iteration count.");
    covered(day);
    if (duration.unit === "calendar-days" || (calendar.workingWeekdays.includes(day.weekday) && !holidays.has(day.toISODate()!))) counted++;
    if (counted < duration.amount) day = day.plus({ days: 1 });
  }
  const components = calendar.cutoff === "same-local-time"
    ? { hour: local.hour, minute: local.minute, second: local.second, millisecond: local.millisecond }
    : (() => { const [h, m, s] = calendar.cutoff.split(":"); return { hour: Number(h), minute: Number(m), second: Math.floor(Number(s)), millisecond: Math.round((Number(s) % 1) * 1000) }; })();
  let due = DateTime.fromObject({ year: day.year, month: day.month, day: day.day, ...components }, { zone: calendar.timezone });
  if (!due.isValid) throw new Error(`Invalid calendar result: ${due.invalidExplanation}`);
  if ((due.hour !== components.hour || due.minute !== components.minute) && calendar.nonexistentTime === "reject") throw new Error("Due time falls in a nonexistent local time; a reviewed correction is required.");
  const offsets = due.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis());
  due = calendar.ambiguousTime === "earlier" ? offsets[0] : offsets[offsets.length - 1];
  return {
    dueAt: due.toUTC().toISO()!,
    localDue: due.toISO()!,
    explanation: `${duration.amount} ${duration.unit} from the recorded trigger; trigger day ${calendar.triggerDay}; ${calendar.timezone}; cutoff ${calendar.cutoff}; ${calendar.approvalStatus === "approved-governed" ? "governed calendar" : "calendar not approved for reliance"}. The outer limit is not permission to wait.`,
  };
}
