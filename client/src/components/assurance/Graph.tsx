import { useState } from "react";
import { Download, Network } from "lucide-react";
import {
  Badge,
  Empty,
  HumanDetail,
  Inspector,
  Json,
  Panel,
  RecordList,
  ResourceState,
} from "./Common";
import {
  id,
  label,
  payload,
  rows,
  saveJson,
  scoped,
  text,
  useResource,
  type Row,
} from "./api";

export function Graph({
  auditId,
  findingId,
  onNavigate,
}: {
  auditId: string;
  findingId: string;
  onNavigate?: (view: string) => void;
}) {
  const [asOfInput, setAsOfInput] = useState("");
  const [effectiveInput, setEffectiveInput] = useState("");
  const [times, setTimes] = useState({ asOf: "", effectiveAt: "" });
  const resource = useResource(
    scoped("/api/graph/context", auditId, { findingId, ...times })
  );
  const [selected, setSelected] = useState<{ kind: string; row: Row } | null>(
    null
  );
  const nodes = rows(resource.data, "nodes", "entities");
  const edges = rows(resource.data, "edges", "relationships");
  const events = rows(resource.data, "temporalEvents", "events");
  const pending = payload(resource.data).pendingPromotion as Row | undefined;
  const quantity = (value: unknown, singular: string, plural = `${singular}s`) => {
    const count = Number(value ?? 0);
    return `${count} ${count === 1 ? singular : plural}`;
  };
  // Position only real nodes. Layout coordinates are presentation, not database facts.
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const height = Math.max(320, Math.ceil(nodes.length / columns) * 125 + 80);
  const positions = new Map(
    nodes.map((node, index) => [
      id(node),
      {
        x: 80 + (index % columns) * (660 / Math.max(1, columns - 1)),
        y: 70 + Math.floor(index / columns) * 125,
      },
    ])
  );
  const attached =
    selected?.kind === "node"
      ? edges.filter(
          e =>
            (e.from ?? e.fromId ?? e.source) === id(selected.row) ||
            (e.to ?? e.toId ?? e.target) === id(selected.row)
        )
      : [];
  const select = (kind: string, row: Row) => setSelected({ kind, row });
  return (
    <div className="view-stack">
      <Panel
        title="Audit-bounded genealogy graph"
        subtitle={`Audit ${auditId} · finding ${findingId || "Whole authorized audit"} · exact temporal query, no fixture projection`}
        actions={
          <button
            className="ghost-button"
            disabled={!resource.data}
            onClick={() => saveJson(`graph-${auditId}.json`, resource.data)}
          >
            <Download size={13} />
            Export returned trace
          </button>
        }
      >
        <div className="assurance-form assurance-query-form">
          <label>
            Known as of (transaction time)
            <input
              type="datetime-local"
              value={asOfInput}
              onChange={e => setAsOfInput(e.target.value)}
            />
          </label>
          <label>
            Effective at (valid time)
            <input
              type="datetime-local"
              value={effectiveInput}
              onChange={e => setEffectiveInput(e.target.value)}
            />
          </label>
          <button
            className="ghost-button"
            onClick={() =>
              setTimes({
                asOf: asOfInput ? new Date(asOfInput).toISOString() : "",
                effectiveAt: effectiveInput
                  ? new Date(effectiveInput).toISOString()
                  : "",
              })
            }
          >
            Apply actual temporal query
          </button>
        </div>
        <ResourceState resource={resource} />
        {resource.data != null && (
          <>
            <div className="assurance-inline">
              <Badge>{text(resource.data.source, "Source not returned")}</Badge>
              <span>
                {nodes.length} returned nodes · {edges.length} returned
                relationships · {events.length} returned temporal events
              </span>
              <span>
                Ontology {text(resource.data.ontologyVersion, "Not returned")}
              </span>
            </div>
            {nodes.length ? (
              <div className="graph-canvas assurance-live-graph">
                <svg
                  viewBox={`0 0 820 ${height}`}
                  aria-label="Database audit-scoped graph"
                >
                  <defs>
                    <pattern
                      id="assurance-graph-grid"
                      width="36"
                      height="36"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M 36 0 L 0 0 0 36"
                        fill="none"
                        stroke="#b7d0ef"
                        strokeOpacity=".07"
                      />
                    </pattern>
                  </defs>
                  <rect
                    width="820"
                    height={height}
                    fill="url(#assurance-graph-grid)"
                  />
                  {edges.map((edge, index) => {
                    const a = positions.get(
                      String(edge.from ?? edge.fromId ?? edge.source)
                    );
                    const b = positions.get(
                      String(edge.to ?? edge.toId ?? edge.target)
                    );
                    if (!a || !b) return null;
                    return (
                      <g
                        key={id(edge) || index}
                        tabIndex={0}
                        role="button"
                        aria-label={`Inspect ${label(edge, "relationship")}`}
                        onClick={() => select("edge", edge)}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ")
                            select("edge", edge);
                        }}
                      >
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="#59d8e8"
                          strokeOpacity=".4"
                          strokeWidth={
                            selected?.kind === "edge" &&
                            id(selected.row) === id(edge)
                              ? 4
                              : 1.6
                          }
                        />
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="transparent"
                          strokeWidth="16"
                        />
                        <text
                          x={(a.x + b.x) / 2}
                          y={(a.y + b.y) / 2 - 7}
                          textAnchor="middle"
                          fill="#91a7c4"
                          fontSize="9"
                        >
                          {text(
                            edge.relation ?? edge.label,
                            "Unlabelled relation"
                          ).slice(0, 32)}
                        </text>
                      </g>
                    );
                  })}
                  {nodes.map(node => {
                    const pos = positions.get(id(node));
                    if (!pos) return null;
                    const active =
                      selected?.kind === "node" &&
                      id(selected.row) === id(node);
                    return (
                      <g
                        key={id(node)}
                        className="graph-node"
                        role="button"
                        tabIndex={0}
                        aria-label={`Inspect ${label(node)}`}
                        onClick={() => select("node", node)}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ")
                            select("node", node);
                        }}
                      >
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={active ? 24 : 20}
                          fill="#101b2b"
                          stroke={active ? "#f2b85b" : "#59d8e8"}
                          strokeWidth={active ? 3 : 1.5}
                        />
                        <text
                          x={pos.x}
                          y={pos.y + 4}
                          fill="#e8f0f7"
                          fontSize="10"
                          textAnchor="middle"
                        >
                          {String(node.type ?? node.nodeType ?? "?")
                            .slice(0, 3)
                            .toUpperCase()}
                        </text>
                        <text
                          x={pos.x}
                          y={pos.y + 38}
                          fill="#b8c8dc"
                          textAnchor="middle"
                          fontSize="11"
                        >
                          {label(node).slice(0, 35)}
                        </text>
                        <text
                          x={pos.x}
                          y={pos.y + 52}
                          fill="#71839c"
                          textAnchor="middle"
                          fontSize="8"
                        >
                          {id(node).slice(0, 35)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <Empty>
                <div className="graph-empty">
                  <strong>
                    No approved graph projection exists for {auditId}
                    {findingId ? ` / ${findingId}` : ""} yet.
                  </strong>
                  <p>
                    The genealogy graph is populated from persisted audit
                    records only after a qualified report approval promotes
                    them. This audit has no promoted projection for the
                    selected time window, so no nodes, relationships, or
                    temporal events are loaded. The system does not fabricate
                    a graph from narrative records.
                  </p>
                  <p>
                    To populate it, open <b>Audit reports</b>, route the final
                    report to a qualified approver, and complete approval. That
                    approval writes the immutable snapshot and promotes the
                    audit&apos;s findings, evidence, products, suppliers,
                    changes, and controls into the graph.
                  </p>
                  {pending && (
                    <p>
                      <b>Persisted and waiting for promotion:</b>{" "}
                      {quantity(pending.findings, "finding")},{" "}
                      {quantity(pending.evidence, "evidence record")},{" "}
                      {quantity(pending.controls, "control")},{" "}
                      {quantity(pending.suppliers, "supplier")} and{" "}
                      {quantity(pending.changes, "change")}. They remain
                      audit records, not graph nodes, until the approval gate is
                      completed.
                    </p>
                  )}
                  {onNavigate && (
                    <button
                      className="ghost-button"
                      onClick={() => onNavigate("reports")}
                    >
                      Open Audit reports
                    </button>
                  )}
                </div>
              </Empty>
            )}
            <Json
              value={resource.data}
              title="Complete query proof, schema, source revisions and exact traversed IDs"
            />
          </>
        )}
      </Panel>
      <div className="overview-grid">
        <Panel
          title="Relationship register"
          subtitle="Select any persisted edge, including edges without visible endpoint coordinates."
        >
          <RecordList
            data={edges}
            onInspect={row => select("edge", row)}
            empty="No relationships returned."
          />
        </Panel>
        <Panel
          title="Temporal events"
          subtitle="Actual event IDs, valid time and recorded time are preserved."
        >
          {events.length ? (
            events.map((event, index) => (
              <button
                className="assurance-event"
                key={id(event) || index}
                onClick={() => select("event", event)}
              >
                <Network size={14} />
                <span>
                  <strong>
                    {text(event.operation ?? event.type)} ·{" "}
                    {text(event.entityId)}
                  </strong>
                  <small>Event {text(event.id, "Missing event ID")}</small>
                  <small>
                    Valid {text(event.validFrom ?? event.occurredAt)} · recorded{" "}
                    {text(event.recordedAt)} ·{" "}
                    {text(event.recordedBy ?? event.actor)}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <Empty>No temporal events returned.</Empty>
          )}
        </Panel>
      </div>
      {selected && (
        <Inspector
          title={`${selected.kind.toUpperCase()} · ${label(selected.row)}`}
          description={`Audit ${auditId} · exact persisted graph response`}
          onClose={() => setSelected(null)}
        >
          <HumanDetail value={selected.row} />
          {selected.kind === "node" && (
            <>
              <h3>Direct returned relationships</h3>
              <RecordList
                data={attached}
                onInspect={row => select("edge", row)}
              />
              <h3>Returned entity events</h3>
              {events
                .filter(event => event.entityId === id(selected.row))
                .map((event, index) => (
                  <Json
                    value={event}
                    key={id(event) || index}
                    title={`Event ${text(event.id)}`}
                  />
                ))}
            </>
          )}
        </Inspector>
      )}
    </div>
  );
}
