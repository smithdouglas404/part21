import { useState } from "react";
import {
  Badge,
  Empty,
  Json,
  JsonOperation,
  Panel,
  ResourceState,
} from "./Common";
import {
  formatDay,
  formatWhen,
  rows,
  scoped,
  text,
  useResource,
  type Row,
} from "./api";

const STATUS_TONE: Record<string, string> = {
  overdue: "danger",
  due_soon: "warn",
  open: "info",
  satisfied: "ok",
  waiting_on_trigger: "muted",
  not_required: "muted",
  unknown: "warn",
};

function daysLabel(value: unknown) {
  if (value === null || value === undefined) return "no computed date";
  const days = Number(value);
  if (!Number.isFinite(days)) return "no computed date";
  if (days < 0)
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} past the outer limit`;
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

function clockTone(status: string) {
  if (status === "red") return "danger";
  if (status === "amber") return "warn";
  if (status === "green") return "ok";
  return "muted";
}

function clockLabel(status: string) {
  if (status === "red") return "Red · action required";
  if (status === "amber") return "Amber · clock running";
  if (status === "green") return "Green · satisfied";
  return "Gray · not started";
}

function caseStatusLabel(value: unknown) {
  const status = String(value ?? "gray");
  if (status === "red") return "Red";
  if (status === "amber") return "Amber";
  if (status === "green") return "Green";
  return "Not started";
}

export function Clocks({
  auditId,
  canWrite,
}: {
  auditId: string;
  canWrite: boolean;
}) {
  const [timezone, setTimezone] = useState("America/New_York");
  const [holidays, setHolidays] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const verification = useResource<any>("/api/regulatory/verification");
  const process = useResource<any>("/api/part21/process");
  const cases = useResource<any>(scoped("/api/part21/cases", auditId));
  const list = rows(cases.data, "cases");

  const query = { timezone, holidays };
  const detail = useResource<any>(
    selectedId
      ? scoped(
          `/api/part21/cases/${encodeURIComponent(selectedId)}`,
          auditId,
          query
        )
      : null
  );

  const branches = rows(process.data, "branches");
  const gates = rows(detail.data, "gates");
  const schedule = rows(detail.data, "branches");
  const calendar = detail.data?.calendar ?? process.data?.calendar ?? {};
  const verified = verification.data;

  const red = list.filter(row => text(row.clockStatus) === "red");
  const amber = list.filter(row => text(row.clockStatus) === "amber");
  const green = list.filter(row => text(row.clockStatus) === "green");
  const notStarted = list.filter(row => text(row.clockStatus) === "gray");
  const overall = !list.length
    ? "gray"
    : red.length
      ? "red"
      : amber.length
        ? "amber"
        : green.length === list.length
          ? "green"
          : "gray";
  const nextDue = list
    .filter(row => row.nextDueAt)
    .sort((a, b) => Date.parse(String(a.nextDueAt)) - Date.parse(String(b.nextDueAt)))[0];

  const overallSentence = !list.length
    ? `No Part 21 evaluation case exists in ${auditId}. No statutory clock has started, and the six branches below are reference only.`
    : overall === "red"
      ? `${red.length} case${red.length === 1 ? "" : "s"} in ${auditId} ${red.length === 1 ? "has" : "have"} an overdue or uncomputable statutory clock. Open the case to see the exact branch, due date and missing fact.`
      : overall === "amber"
        ? `${amber.length} case${amber.length === 1 ? "" : "s"} in ${auditId} ${amber.length === 1 ? "has" : "have"} a running clock. ${nextDue ? `The nearest branch is ${text(nextDue.nextDueLabel, "the next branch")} due ${formatWhen(nextDue.nextDueAt)} (${daysLabel(nextDue.daysRemaining)}).` : "Review the next due date and pending gates."}`
        : overall === "green"
          ? `Every triggered clock in ${auditId} is satisfied and the recorded gates are complete. The case still requires the qualified closure decision shown in the case detail.`
          : `Cases exist in ${auditId}, but no discovery trigger has started a statutory clock. The branches remain gray until a recorded discovery fact exists.`;

  return (
    <div className="view-stack">
      <Panel
        title="Audit clock position"
        subtitle="Red, amber and green are computed from recorded discovery facts, statutory due dates and gate evidence. The color is an operational position, not a legal determination."
        actions={
          <Badge tone={clockTone(overall)}>{clockLabel(overall)}</Badge>
        }
      >
        <ResourceState resource={cases} />
        {!cases.loading && !cases.error && !list.length && (
          <Empty>
            No Part 21 evaluation case exists in this audit. No clock is started
            or fabricated. Open a case only when a discovery fact, reviewer and
            existing evidence are recorded.
          </Empty>
        )}
        {list.length > 0 && (
          <>
            <div className={`clock-rag-banner ${overall}`}>
              <div>
                <span className="tiny-label">AUDIT POSITION</span>
                <strong>{clockLabel(overall)}</strong>
                <p>{overallSentence}</p>
              </div>
              <div className="clock-rag-metrics">
                <div>
                  <strong>{list.length}</strong>
                  <small>cases</small>
                </div>
                <div className="red">
                  <strong>{red.length}</strong>
                  <small>red</small>
                </div>
                <div className="amber">
                  <strong>{amber.length}</strong>
                  <small>amber</small>
                </div>
                <div className="green">
                  <strong>{green.length}</strong>
                  <small>green</small>
                </div>
                <div>
                  <strong>{notStarted.length}</strong>
                  <small>not started</small>
                </div>
              </div>
            </div>
            <div className="clock-legend">
              <span>
                <i className="red" /> Red: overdue or cannot compute the due date.
              </span>
              <span>
                <i className="amber" /> Amber: a clock is running, due within 5
                days, or a gate is pending.
              </span>
              <span>
                <i className="green" /> Green: triggered clocks satisfied and
                gates recorded.
              </span>
              <span>
                <i className="gray" /> Gray: no discovery trigger recorded.
              </span>
            </div>
            <div className="clock-case-list">
              {list.map(row => {
                const caseId = String(row.caseId ?? "");
                const status = text(row.clockStatus, "gray");
                return (
                  <button
                    className={`clock-case-card ${status} ${selectedId === caseId ? "active" : ""}`}
                    key={caseId}
                    onClick={() => setSelectedId(caseId)}
                  >
                    <span className={`clock-case-dot ${status}`} />
                    <span className="clock-case-body">
                      <strong>{caseId || "Case identifier missing"}</strong>
                      <small>{text(row.title, "Title not recorded")}</small>
                      <small>
                        {text(row.activeClocks, "0")} active{" "}
                        {Number(row.activeClocks) === 1 ? "clock" : "clocks"} ·{" "}
                        {text(row.overdueClocks, "0")} overdue ·{" "}
                        {text(row.pendingGates, "0")} pending{" "}
                        {Number(row.pendingGates) === 1 ? "gate" : "gates"}
                        {row.nextDueAt
                          ? ` · next ${text(row.nextDueLabel, "branch")} due ${formatWhen(row.nextDueAt)} (${daysLabel(row.daysRemaining)})`
                          : " · no statutory clock started"}
                      </small>
                    </span>
                    <Badge tone={clockTone(status)}>
                      {caseStatusLabel(status)}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {canWrite && (
          <JsonOperation
            title="Open a case from a recorded discovery fact"
            path="/api/part21/cases"
            auditId={auditId}
            initial={{
              caseId: "",
              title: "",
              findingId: "",
              documentedAt: "",
              basis: "",
              reviewerPersonId: "",
              evidence: [{ id: "", kind: "evidence" }],
            }}
            description="Record the actual discovery time, the basis, the named reviewer and at least one exact evidence reference that already exists in this audit. The documented discovery time is the clock trigger and cannot be rewritten later to restart it."
            onDone={cases.refresh}
          />
        )}
      </Panel>

      <Panel
        title="Statutory branch reference"
        subtitle="These are the six independent, event-triggered branches and their durations. They are reference law, not a status for this audit."
      >
        <ResourceState resource={verification} />
        {verified && (
          <div className="assurance-inline">
            <Badge tone={verified.allVerified ? "ok" : "danger"}>
              {verified.allVerified
                ? `${verified.verified}/${verified.checks?.length ?? 0} citations verified against eCFR`
                : `${verified.mismatched} mismatch · ${verified.missing} missing`}
            </Badge>
            <small>
              Snapshot {text(verified.snapshotId)} · source as-of{" "}
              {formatDay(verified.sourceAsOf)} · amended{" "}
              {formatDay(verified.latestAmendedOn)} · provider current through{" "}
              {formatDay(verified.providerUpToDateAsOf)} · retrieved{" "}
              {formatWhen(verified.retrievedAt, "retrieval time not recorded")}
            </small>
          </div>
        )}
        <p className="assurance-note">
          Section titles below are compared to the exact ingested eCFR text. A
          mismatch means the displayed citation is stale and must not be shown
          as current law. The audit position above is computed only from a
          recorded case, never from this reference list.
        </p>
        <ResourceState resource={process} />
        <details className="clock-reference">
          <summary>
            Show the six statutory branches and their durations
          </summary>
          {branches.map(branch => (
            <div className="assurance-record-row" key={String(branch.id)}>
              <span>
                <strong>{text(branch.label)}</strong>
                <small>
                  {text(branch.citation)} · {text(branch.citationTitle)}
                </small>
                <small>Trigger: {text(branch.triggerFact)}</small>
              </span>
              <Badge>
                {text(branch.duration?.amount)} {text(branch.duration?.unit)}
              </Badge>
            </div>
          ))}
        </details>
      </Panel>

      {detail.data && (
        <Panel
          title={`Case ${selectedId}`}
          subtitle="Dates are computed from the recorded trigger facts under the declared calendar. A calendar that is not approved for reliance is illustrative and is not a legal determination."
          actions={
            <button
              className="ghost-button"
              onClick={() => setSelectedId("")}
            >
              Close case detail
            </button>
          }
        >
          <div className="assurance-inline">
            <label>
              Timezone
              <input
                value={timezone}
                onChange={event => setTimezone(event.target.value)}
                placeholder="America/New_York"
              />
            </label>
            <label>
              Holidays (YYYY-MM-DD, comma separated)
              <input
                value={holidays}
                onChange={event => setHolidays(event.target.value)}
                placeholder="2026-11-26,2026-12-25"
              />
            </label>
          </div>
          <p className="assurance-note">
            Calendar interpretation: {text(calendar.approvalStatus)} ·{" "}
            {text(calendar.timezone)} · working weekdays{" "}
            {Array.isArray(calendar.workingWeekdays)
              ? calendar.workingWeekdays.join(", ")
              : "unknown"}{" "}
            · trigger day {text(calendar.triggerDay)}
          </p>
          {schedule.map(branch => (
            <div className="assurance-approval" key={String(branch.id)}>
              <div className="assurance-inline">
                <strong>{text(branch.label)}</strong>
                <Badge tone={STATUS_TONE[String(branch.status)] ?? "muted"}>
                  {text(branch.status).replace(/_/g, " ")}
                </Badge>
              </div>
              <p>
                {text(branch.citation)} · trigger{" "}
                {formatWhen(branch.triggerAt, "not triggered")} · due{" "}
                {formatWhen(branch.dueAt, "not computed")} ·{" "}
                {daysLabel(branch.daysRemaining)}
              </p>
              <small>
                {text(branch.explanation, "No computation basis returned")}
              </small>
            </div>
          ))}
          <h3>Human gates</h3>
          {gates.map(gate => (
            <div className="assurance-record-row" key={String(gate.id)}>
              <span>
                <strong>{text(gate.label)}</strong>
                <small>
                  {text(gate.citation)} · {text(gate.question)}
                </small>
                <small>
                  Decided by {text(gate.decidedBy)} · evidence{" "}
                  {Array.isArray(gate.evidenceIds) && gate.evidenceIds.length
                    ? gate.evidenceIds.join(", ")
                    : "none recorded"}
                </small>
                <small>Prohibited: {text(gate.prohibits)}</small>
              </span>
              <Badge tone={gate.state === "recorded" ? "ok" : "muted"}>
                {text(gate.state)}
              </Badge>
            </div>
          ))}
          <Json
            value={detail.data}
            title="Exact stored case facts and computed schedule"
          />
          {canWrite && (
            <JsonOperation
              title="Record a gate fact"
              path={`/api/part21/cases/${encodeURIComponent(selectedId)}/facts`}
              auditId={auditId}
              initial={{
                gate: "applicability",
                expectedRevision: undefined,
                data: {
                  outcome: "in_scope",
                  basis: "",
                  reviewerPersonId: "",
                  evidence: [{ id: "", kind: "evidence" }],
                },
              }}
              description="Choose the gate, then supply the real decision, the named reviewer and exact evidence that already exists in this audit. Reportability and closure additionally require a qualified reviewer identity; the server rejects an unqualified or synthetic approver."
              onDone={() => {
                cases.refresh();
                detail.refresh();
              }}
            />
          )}
        </Panel>
      )}
    </div>
  );
}
