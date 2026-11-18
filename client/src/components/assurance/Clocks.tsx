import { useState } from "react";
import {
  Badge,
  Empty,
  Inspector,
  Json,
  JsonOperation,
  Panel,
  ResourceState,
} from "./Common";
import { rows, scoped, text, useResource, type Row } from "./api";

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
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} past the outer limit`;
  return `${days} day${days === 1 ? "" : "s"} remaining`;
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

  return (
    <div className="view-stack">
      <Panel
        title="Part 21 statutory branches"
        subtitle="Six independent, event-triggered branches. Audit start, a Kanban move, a chat message or an approval click never starts or restarts a clock."
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
              {text(verified.sourceAsOf)} · amended {text(verified.latestAmendedOn)} ·
              provider current through {text(verified.providerUpToDateAsOf)} ·
              retrieved {text(verified.retrievedAt)}
            </small>
          </div>
        )}
        <p className="assurance-note">
          Section titles below are compared to the exact ingested eCFR text. A
          mismatch means the displayed citation is stale and must not be shown as
          current law.
        </p>
        <ResourceState resource={process} />
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
      </Panel>

      <Panel
        title="Evaluation cases in this audit"
        subtitle="A case is opened on a recorded discovery fact with exact evidence. Opening a second case for the same condition would restart the statutory clock, so the server refuses it."
      >
        <ResourceState resource={cases} />
        {!cases.loading && !cases.error && !list.length && (
          <Empty>
            No Part 21 evaluation case exists in this audit. No clock is started
            or fabricated.
          </Empty>
        )}
        {list.map((row, index) => {
          const caseId = String(row.caseId ?? "");
          return (
            <button
              className="assurance-record-row"
              key={caseId || index}
              onClick={() => setSelectedId(caseId)}
            >
              <span>
                <strong>{caseId || "Case identifier missing"}</strong>
                <small>
                  {text(row.title)} · discovery {text(row.createdAt)}
                </small>
              </span>
              <Badge tone={row.closed ? "ok" : "warn"}>
                {row.closed ? "Closed" : "Open"}
              </Badge>
            </button>
          );
        })}
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

      {detail.data && (
        <Panel
          title={`Case ${selectedId}`}
          subtitle="Dates are computed from the recorded trigger facts under the declared calendar. A calendar that is not approved for reliance is illustrative and is not a legal determination."
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
                {text(branch.citation)} · trigger {text(branch.triggerAt)} · due{" "}
                {text(branch.dueAt)} · {daysLabel(branch.daysRemaining)}
              </p>
              <small>{text(branch.explanation, "No computation basis returned")}</small>
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
