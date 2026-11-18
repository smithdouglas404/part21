import { DateTime, IANAZone } from "luxon";
import type { ApprovedSnapshot, CalendarSnapshot, Deadline, DeadlineBranch, DurationRule, PolicySnapshot } from "./contracts";

export function requireText(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 180) throw new Error(`${label} is required (maximum 180 characters)`);
}
export function requireInstant(value: string, label: string): void {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !DateTime.fromISO(value, { setZone: true }).isValid) throw new Error(`${label} must be an ISO timestamp with an explicit offset`);
}
export function validateApprovedSnapshot(snapshot: ApprovedSnapshot): void {
  if (!snapshot) throw new Error("Approved snapshot is required");
  for (const key of ["id", "version", "approvalDecisionId", "approvedBy"] as const) requireText(snapshot[key], key);
  if (!/^[a-f0-9]{64}$/i.test(snapshot.sha256)) throw new Error("Snapshot sha256 is required");
  requireInstant(snapshot.approvedAt, "approvedAt");
  if (!snapshot.sourceIds?.length) throw new Error("Exact source IDs are required");
  snapshot.sourceIds.forEach(id => requireText(id, "sourceId"));
}
export function validateCalendar(calendar: CalendarSnapshot): void {
  validateApprovedSnapshot(calendar);
  if (!IANAZone.isValidZone(calendar.timezone)) throw new Error("Reviewed IANA timezone is required");
  if (!calendar.workingWeekdays?.length || calendar.workingWeekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7)) throw new Error("Working weekdays must use ISO values 1-7");
  for (const d of [...calendar.holidays, calendar.validFrom, calendar.validThrough]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !DateTime.fromISO(d).isValid) throw new Error("Calendar dates must be valid YYYY-MM-DD");
  }
  if (calendar.validFrom > calendar.validThrough) throw new Error("Calendar coverage is inverted");
  if (!["exclude", "include"].includes(calendar.triggerDay) || !["earlier", "later"].includes(calendar.ambiguousTime) || !["reject", "next-valid"].includes(calendar.nonexistentTime)) throw new Error("Reviewed calendar boundary interpretation is required");
  if (calendar.cutoff !== "same-local-time" && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?$/.test(calendar.cutoff)) throw new Error("Calendar cutoff must be same-local-time or HH:mm:ss[.SSS]");
}
export function validatePolicy(policy: PolicySnapshot): void {
  validateApprovedSnapshot(policy);
  for (const branch of ["evaluation", "supplier", "officer", "nrc-initial", "nrc-written"] as const) {
    const rule = policy.rules?.[branch];
    if (!rule || !Number.isInteger(rule.amount) || rule.amount <= 0 || rule.amount > 36600 || !["calendar-days", "working-days"].includes(rule.unit)) throw new Error(`Missing/invalid approved duration for ${branch}`);
    validateCalendar(rule.calendar);
  }
  if (!Array.isArray(policy.reminderLeadMilliseconds) || policy.reminderLeadMilliseconds.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error("Explicit reviewed reminder lead times are required; [] disables reminders");
}

/** Pure calculation; no clock/provider/holiday lookup. Executed outside workflow replay. */
export function calculateDueAt(triggerAt: string, rule: DurationRule): { dueAt: string; localDue: string; explanation: string } {
  requireInstant(triggerAt, "triggerAt"); validateCalendar(rule.calendar);
  if (!Number.isInteger(rule.amount) || rule.amount <= 0 || rule.amount > 36600) throw new Error("Positive bounded policy duration required");
  const c = rule.calendar;
  const trigger = DateTime.fromISO(triggerAt, { zone: c.timezone });
  let day = trigger.startOf("day");
  let counted = 0;
  const holidays = new Set(c.holidays);
  function covered(d: DateTime): void {
    const date = d.toISODate()!;
    if (date < c.validFrom || date > c.validThrough) throw new Error(`Approved calendar does not cover ${date}; deadline is unknown until calendar approval`);
  }
  covered(day);
  if (c.triggerDay === "exclude") day = day.plus({ days: 1 });
  while (counted < rule.amount) {
    covered(day);
    if (rule.unit === "calendar-days" || (c.workingWeekdays.includes(day.weekday) && !holidays.has(day.toISODate()!))) counted++;
    if (counted < rule.amount) day = day.plus({ days: 1 });
  }
  const components = c.cutoff === "same-local-time"
    ? { hour: trigger.hour, minute: trigger.minute, second: trigger.second, millisecond: trigger.millisecond }
    : (() => { const [h, m, s] = c.cutoff.split(":"); return { hour: Number(h), minute: Number(m), second: Math.floor(Number(s)), millisecond: Math.round((Number(s) % 1) * 1000) }; })();
  let due = DateTime.fromObject({ year: day.year, month: day.month, day: day.day, ...components }, { zone: c.timezone });
  if (!due.isValid) throw new Error(`Invalid calendar result: ${due.invalidExplanation}`);
  if ((due.hour !== components.hour || due.minute !== components.minute) && c.nonexistentTime === "reject") throw new Error("Due time falls in a nonexistent local DST time; reviewed correction required");
  const offsets = due.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis());
  due = c.ambiguousTime === "earlier" ? offsets[0] : offsets[offsets.length - 1];
  return { dueAt: due.toUTC().toISO()!, localDue: due.toISO()!, explanation: `${rule.amount} ${rule.unit}; trigger day ${c.triggerDay}; ${c.timezone}; cutoff ${c.cutoff}; calendar ${c.id}@${c.version}; coverage ${c.validFrom}..${c.validThrough}; DST ${c.ambiguousTime}/${c.nonexistentTime}. As soon as practicable; outer limit is not permission to wait.` };
}
export function buildDeadline(branch: DeadlineBranch, triggerAt: string, policy: PolicySnapshot, ruleBranch: keyof PolicySnapshot["rules"] = branch as keyof PolicySnapshot["rules"]): Deadline {
  const rule = policy.rules[ruleBranch];
  if (!rule) throw new Error(`No approved rule for ${branch}`);
  return { branch, triggerAt, ...calculateDueAt(triggerAt, rule), policyId: policy.id, policyVersion: policy.version, calendarId: rule.calendar.id, calendarVersion: rule.calendar.version, sourceIds: [...new Set([...policy.sourceIds, ...rule.calendar.sourceIds])], status: "pending", applicability: "required" };
}
