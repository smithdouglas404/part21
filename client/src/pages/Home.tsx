import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Boxes,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  Command,
  Cpu,
  DatabaseZap,
  FileCheck2,
  FileSearch,
  GitBranch,
  GitCompareArrows,
  Gauge,
  HardHat,
  History,
  Inbox,
  Layers3,
  Link2,
  ListChecks,
  LockKeyhole,
  MapPin,
  Network,
  Play,
  Radio,
  Radar,
  RefreshCw,
  Search,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  UserRoundCheck,
  Users,
  Waypoints,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import {
  activity,
  agentPulse,
  audits,
  controls,
  evidence,
  findings,
  getGraphNode,
  graphEdges,
  graphNodes,
  mcpTools,
  metrics,
  sources,
  timelineEvents,
  type AuditRecord,
  type ControlRecord,
  type EntityType,
  type GraphNode,
  type RiskTone,
  type ViewId,
} from "@shared/demo";

const navItems: { id: ViewId; label: string; icon: typeof Activity; count?: string }[] = [
  { id: "overview", label: "Command center", icon: Gauge },
  { id: "audit", label: "Audit workbench", icon: ClipboardCheck, count: "3" },
  { id: "graph", label: "Genealogy graph", icon: Network },
  { id: "evidence", label: "Evidence register", icon: FileCheck2, count: "84" },
  { id: "controls", label: "Control coverage", icon: ShieldCheck },
  { id: "data", label: "Data plane & MCP", icon: DatabaseZap },
];

const toneColor: Record<RiskTone, string> = {
  cyan: "#59d8e8",
  green: "#63d8a0",
  amber: "#f2b85b",
  red: "#f27373",
  blue: "#80a9ff",
};

const entityIcon: Record<EntityType, typeof Activity> = {
  requirement: ListChecks,
  product: Boxes,
  supplier: Building2,
  evidence: FileCheck2,
  person: UserRoundCheck,
  change: GitBranch,
  finding: ShieldAlert,
};

function StatusDot({ tone = "cyan", pulse = false }: { tone?: RiskTone; pulse?: boolean }) {
  return <span className={`status-dot ${pulse ? "pulse" : ""}`} style={{ background: toneColor[tone], boxShadow: `0 0 0 3px ${toneColor[tone]}20` }} />;
}

function Badge({ children, tone = "cyan", subtle = false }: { children: ReactNode; tone?: RiskTone; subtle?: boolean }) {
  return <span className={`badge ${subtle ? "badge-subtle" : ""}`} style={{ color: toneColor[tone], borderColor: `${toneColor[tone]}42`, background: `${toneColor[tone]}12` }}>{children}</span>;
}

function SectionKicker({ icon: Icon, children }: { icon: typeof Activity; children: ReactNode }) {
  return <div className="section-kicker"><Icon size={13} strokeWidth={2.5} /><span>{children}</span></div>;
}

function MetricCard({ label, value, delta, detail, icon: Icon, tone, trend = "up" }: { label: string; value: string | number; delta: string; detail: string; icon: typeof Activity; tone: RiskTone; trend?: "up" | "down" }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><div className="metric-icon" style={{ color: toneColor[tone], background: `${toneColor[tone]}12` }}><Icon size={16} /></div><span className="metric-label">{label}</span><span className="metric-menu">···</span></div>
      <div className="metric-value-row"><strong>{value}</strong><span className={`metric-delta ${trend === "down" ? "delta-down" : ""}`}><ArrowUpRight size={13} />{delta}</span></div>
      <div className="metric-detail">{detail}</div>
      <div className="metric-spark" aria-hidden="true"><span style={{ height: "38%" }} /><span style={{ height: "52%" }} /><span style={{ height: "45%" }} /><span style={{ height: "68%" }} /><span style={{ height: "58%" }} /><span style={{ height: "78%" }} /><span style={{ height: "92%", background: toneColor[tone] }} /></div>
    </article>
  );
}

function GraphCanvas({ selectedId, onSelect, compact = false }: { selectedId: string; onSelect: (id: string) => void; compact?: boolean }) {
  const nodesById = Object.fromEntries(graphNodes.map((node) => [node.id, node]));
  return (
    <div className={`graph-canvas ${compact ? "graph-compact" : ""}`}>
      <svg viewBox="0 0 820 370" role="img" aria-label="Part 21 entity relationship graph">
        <defs>
          <pattern id="graph-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#b7d0ef" strokeOpacity=".07" strokeWidth="1" /></pattern>
          <filter id="node-glow"><feGaussianBlur stdDeviation="4" result="coloredBlur" /><feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width="820" height="370" fill="url(#graph-grid)" />
        {graphEdges.map((edge) => {
          const from = nodesById[edge.from]; const to = nodesById[edge.to];
          return <g key={`${edge.from}-${edge.to}`} className="graph-edge-group"><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={toneColor[edge.tone]} strokeOpacity=".42" strokeWidth={selectedId === edge.from || selectedId === edge.to ? 2.7 : 1.4} strokeDasharray={edge.tone === "red" ? "5 4" : ""} /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 7} textAnchor="middle" fill="#91a7c4" fontSize="9" letterSpacing=".08em">{edge.label.toUpperCase()}</text></g>;
        })}
        {graphNodes.map((node) => {
          const Icon = entityIcon[node.type];
          const isSelected = selectedId === node.id;
          return <g key={node.id} className={`graph-node ${isSelected ? "selected" : ""}`} onClick={() => onSelect(node.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(node.id); }}>
            {isSelected && <circle cx={node.x} cy={node.y} r="32" fill="none" stroke={toneColor[node.tone]} strokeOpacity=".18" strokeWidth="8" filter="url(#node-glow)" />}
            <circle cx={node.x} cy={node.y} r={isSelected ? 22 : 18} fill="#101b2b" stroke={toneColor[node.tone]} strokeWidth={isSelected ? 2.5 : 1.5} />
            <foreignObject x={node.x - 10} y={node.y - 10} width="20" height="20"><div className="graph-node-icon" style={{ color: toneColor[node.tone] }}><Icon size={13} /></div></foreignObject>
            <text x={node.x} y={node.y + 39} textAnchor="middle" fill={isSelected ? "#f5f9ff" : "#b8c8dc"} fontSize="11" fontWeight={isSelected ? 700 : 500}>{node.label}</text>
            <text x={node.x} y={node.y + 52} textAnchor="middle" fill="#71839c" fontSize="8" letterSpacing=".08em">{node.meta.toUpperCase()}</text>
          </g>;
        })}
      </svg>
      <div className="graph-legend"><span><i className="legend-line" style={{ background: toneColor.cyan }} />governs</span><span><i className="legend-line" style={{ background: toneColor.green }} />evidence</span><span><i className="legend-line" style={{ background: toneColor.red }} />risk / change</span><span className="graph-hint">Select an entity to inspect the trace</span></div>
    </div>
  );
}

function AgentRail({ onRun }: { onRun: (label: string) => void }) {
  return (
    <aside className="agent-rail">
      <div className="agent-rail-head"><div className="agent-orb"><Bot size={18} /></div><div><div className="agent-title">Assurance agents</div><div className="agent-subtitle"><StatusDot tone="green" pulse /> {agentPulse.state} · 3 watchers active</div></div><button className="icon-button" aria-label="Agent settings"><SlidersHorizontal size={15} /></button></div>
      <div className="agent-context"><div className="tiny-label">Current operating context</div><strong>Unit 2 / NSS-4820</strong><span>Audit AUD-026 · traceability & configuration</span></div>
      <div className="recommendation"><div className="recommendation-head"><Sparkles size={14} /><span>RECOMMENDED NEXT MOVE</span><Badge tone="amber">Review</Badge></div><p>{agentPulse.recommendation}</p><button className="text-button" onClick={() => onRun("Recommendation accepted · opened F-042 trace")}>Open trace <ChevronRight size={14} /></button></div>
      <div className="agent-activity-head"><span>Live activity</span><span className="agent-activity-meta">{agentPulse.coverage}</span></div>
      <div className="activity-list">{activity.map((item) => <div className="activity-item" key={`${item.time}-${item.title}`}><StatusDot tone={item.tone} pulse={item.tone === "red"} /><div><div className="activity-title">{item.title}<span>{item.time}</span></div><p>{item.detail}</p></div></div>)}</div>
      <div className="agent-actions"><button onClick={() => onRun("Readiness check completed · 82% coverage")}><Radar size={14} />Run readiness check</button><button onClick={() => onRun("Genealogy trace queued · 8 entities")}><GitCompareArrows size={14} />Trace genealogy</button><button onClick={() => onRun("Supplier risk scan completed · watch status")}><Building2 size={14} />Scan supplier risk</button></div>
      <div className="agent-foot"><Radio size={13} /><span>Every recommendation keeps its evidence basis and asks for human review before action.</span></div>
    </aside>
  );
}

function ActiveAudit({ onOpen }: { onOpen: () => void }) {
  const audit = audits[0];
  return <article className="panel active-audit"><div className="panel-head"><div><SectionKicker icon={ClipboardCheck}>Active audit</SectionKicker><h2>{audit.title}</h2><p>{audit.standard} <span className="muted-dot">·</span> {audit.scope}</p></div><button className="ghost-button" onClick={onOpen}>Open workbench <ArrowUpRight size={14} /></button></div><div className="audit-identity"><div className="audit-id">{audit.id}</div><Badge tone="amber">{audit.status}</Badge><div className="audit-owner"><span className="avatar avatar-cyan">ML</span><span><b>{audit.owner}</b><small>audit lead</small></span></div><div className="audit-due"><CalendarClock size={15} /><span><small>DUE</small>{audit.due}</span></div></div><div className="audit-progress-row"><div><span className="tiny-label">Evidence coverage</span><strong>{audit.evidence}</strong></div><div className="progress-bar"><span style={{ width: `${audit.progress}%` }} /></div><strong className="progress-number">{audit.progress}%</strong></div><div className="audit-foot"><span><CircleAlert size={14} className="icon-amber" />3 open findings in scope</span><span><Link2 size={14} />47 linked records</span><button className="text-button" onClick={onOpen}>Continue audit <ChevronRight size={14} /></button></div></article>;
}

function TemporalTrace({ onRun }: { onRun: (label: string) => void }) {
  const [mode, setMode] = useState<"before" | "after">("after");
  const visibleEvents = mode === "before" ? timelineEvents.slice(0, 2) : timelineEvents.slice(2);
  return <article className="panel temporal-panel"><div className="panel-head"><div><SectionKicker icon={History}>Temporal trace</SectionKicker><h2>What changed, and why?</h2><p>Selected context: <strong>NSS-4820</strong> · effective state comparison</p></div><button className="icon-button" aria-label="Refresh temporal trace" onClick={() => onRun("Temporal trace refreshed · 5 events resolved")}><RefreshCw size={15} /></button></div><div className="temporal-toggle"><button className={mode === "before" ? "active" : ""} onClick={() => setMode("before")}>Before <span>14 Mar 2026</span></button><div className="temporal-arrow"><ArrowDownRight size={13} /></div><button className={mode === "after" ? "active" : ""} onClick={() => setMode("after")}>After <span>14 Apr 2026</span></button></div><div className="timeline">{visibleEvents.map((event) => <div className="timeline-row" key={event.id}><div className={`timeline-marker marker-${event.type}`}><span /></div><div className="timeline-date">{event.date}</div><div className="timeline-copy"><strong>{event.title}</strong><p>{event.detail}</p><small>{event.actor} <span>·</span> <b>{event.impact}</b></small></div></div>)}</div><div className="temporal-foot"><span><GitCompareArrows size={14} />{mode === "before" ? "2 baseline events" : "3 change-impact events"}</span><button className="text-button" onClick={() => onRun("Temporal compare exported · CHG-014 context")}>Compare full history <ArrowUpRight size={14} /></button></div></article>;
}

function SelectedNode({ node, onRun }: { node: GraphNode; onRun: (label: string) => void }) {
  const Icon = entityIcon[node.type];
  const linked = graphEdges.filter((edge) => edge.from === node.id || edge.to === node.id);
  return <div className="selected-node"><div className="selected-node-top"><div className="selected-node-icon" style={{ color: toneColor[node.tone], background: `${toneColor[node.tone]}15` }}><Icon size={17} /></div><div><span className="tiny-label">Selected entity</span><strong>{node.label}</strong><small>{node.meta} · {node.status}</small></div><button className="icon-button"><X size={14} /></button></div><p>{node.description}</p><div className="selected-links"><span><Waypoints size={13} />{linked.length} direct relationships</span><span><FileSearch size={13} />3 evidence items</span></div><button className="full-button" onClick={() => onRun(`Trace opened · ${node.label} · ${linked.length} relationships`)}>Open full trace <ArrowUpRight size={14} /></button></div>;
}

function GenealogyPreview({ onOpen, onRun }: { onOpen: () => void; onRun: (label: string) => void }) {
  const [selectedId, setSelectedId] = useState("prod-4820");
  const node = getGraphNode(selectedId);
  return <article className="panel graph-panel"><div className="panel-head"><div><SectionKicker icon={Network}>Knowledge graph</SectionKicker><h2>Trace the assurance chain</h2><p>8 entities · 8 relationships · live synthetic graph</p></div><button className="ghost-button" onClick={onOpen}>Explore graph <ArrowUpRight size={14} /></button></div><GraphCanvas selectedId={selectedId} onSelect={setSelectedId} compact /><SelectedNode node={node} onRun={onRun} /></article>;
}

function FindingList({ onRun }: { onRun: (label: string) => void }) {
  return <article className="panel findings-panel"><div className="panel-head"><div><SectionKicker icon={ShieldAlert}>Finding queue</SectionKicker><h2>Needs accountable attention</h2><p>Prioritized by risk, age, and evidence weakness</p></div><button className="icon-button" aria-label="Filter findings"><SlidersHorizontal size={15} /></button></div><div className="finding-list">{findings.map((finding) => <button className="finding-row" key={finding.id} onClick={() => onRun(`Opened ${finding.id} · ${finding.status}`)}><span className={`finding-severity severity-${finding.severity.toLowerCase()}`}><span />{finding.severity}</span><div className="finding-main"><strong>{finding.id} · {finding.title}</strong><small>{finding.source} <span>·</span> owner {finding.owner}</small></div><span className="finding-age">{finding.age}<ChevronRight size={14} /></span></button>)}</div><button className="panel-link" onClick={() => onRun("Finding queue opened · 12 open items")}>View all findings <ArrowUpRight size={14} /></button></article>;
}

function Overview({ onNavigate, onRun }: { onNavigate: (view: ViewId) => void; onRun: (label: string) => void }) {
  return <>
    <div className="metric-grid"><MetricCard label="Audit readiness" value={`${metrics.readiness}%`} delta={metrics.readinessDelta} detail="vs. last weekly baseline" icon={Gauge} tone="cyan" /><MetricCard label="Open findings" value={metrics.openFindings} delta="2 urgent" detail="1 major · 4 evidence gaps" icon={ShieldAlert} tone="red" trend="down" /><MetricCard label="Supplier exposure" value={metrics.supplierExposure} delta="1 watch" detail="linked to active changes" icon={Building2} tone="amber" /><MetricCard label="Changes · 30d" value={metrics.changes30d} delta="+4" detail="6 require review" icon={GitBranch} tone="blue" /></div>
    <div className="overview-grid"><div className="overview-left"><ActiveAudit onOpen={() => onNavigate("audit")} /><GenealogyPreview onOpen={() => onNavigate("graph")} onRun={onRun} /></div><div className="overview-right"><TemporalTrace onRun={onRun} /><FindingList onRun={onRun} /></div></div>
  </>;
}

function AuditRow({ audit, onOpen }: { audit: AuditRecord; onOpen: () => void }) {
  return <button className="audit-row" onClick={onOpen}><div className="audit-row-id">{audit.id}</div><div className="audit-row-main"><strong>{audit.title}</strong><small>{audit.standard} <span>·</span> {audit.scope}</small></div><div className="audit-row-progress"><span>{audit.progress}%</span><div className="progress-bar"><span style={{ width: `${audit.progress}%` }} /></div></div><Badge tone={audit.status === "Planned" ? "blue" : audit.status === "Ready for review" ? "green" : "amber"} subtle>{audit.status}</Badge><ChevronRight size={15} /></button>;
}

function AuditView({ onRun }: { onRun: (label: string) => void }) {
  return <div className="view-stack"><div className="view-title-row"><div><SectionKicker icon={ClipboardCheck}>Audit workbench</SectionKicker><h1>Move from scope to evidence-backed conclusion.</h1><p>Three audit programs are in flight across configuration, suppliers, and corrective action.</p></div><button className="primary-button" onClick={() => onRun("New audit draft created · awaiting scope")}> <ClipboardCheck size={15} />Start an audit</button></div><div className="audit-view-grid"><article className="panel audit-list-panel"><div className="panel-head"><div><h2>Audit programs</h2><p>Owner, coverage, status, and finding context</p></div><button className="icon-button"><SlidersHorizontal size={15} /></button></div><div className="audit-list">{audits.map((audit) => <AuditRow key={audit.id} audit={audit} onOpen={() => onRun(`${audit.id} selected · evidence workspace opened`)} />)}</div></article><article className="panel audit-insight-panel"><SectionKicker icon={Sparkles}>Audit copilot</SectionKicker><h2>One evidence chain is blocking sign-off.</h2><p className="lead-copy">AUD-026 is 68% covered. The agent found a missing join between the receiving inspection and the heat-lot record. That same orphaned edge is referenced by F-042.</p><div className="insight-chain"><div><span>01</span><strong>Receiving inspection</strong><small>EV-803 · 71% confidence</small></div><ChevronRight size={16} /><div className="chain-risk"><span>02</span><strong>Heat-lot record</strong><small>Missing link · review due</small></div><ChevronRight size={16} /><div><span>03</span><strong>Baseline acceptance</strong><small>Blocked until resolved</small></div></div><div className="insight-actions"><button className="full-button" onClick={() => onRun("Evidence chain opened · EV-803")}>Open evidence chain <ArrowUpRight size={14} /></button><button className="ghost-button" onClick={() => onRun("Finding draft prepared · human review required")}>Draft finding <FileSearch size={14} /></button></div></article></div><div className="workbench-strip"><span><StatusDot tone="green" pulse />Evidence graph synced 3 minutes ago</span><span><Cpu size={14} />4 agent recommendations awaiting review</span><span><LockKeyhole size={14} />Human approval remains required</span></div></div>;
}

function GraphView({ onRun }: { onRun: (label: string) => void }) {
  const [selectedId, setSelectedId] = useState("prod-4820");
  const selected = getGraphNode(selectedId);
  return <div className="view-stack"><div className="view-title-row"><div><SectionKicker icon={Network}>Genealogy graph</SectionKicker><h1>See the links that make a conclusion defensible.</h1><p>Click through products, requirements, suppliers, changes, people, and evidence.</p></div><button className="primary-button" onClick={() => onRun("Graph query exported · 8 entities")}> <Link2 size={15} />Export trace</button></div><div className="graph-view-grid"><article className="panel graph-large-panel"><div className="panel-head"><div><h2>Unit 2 / NSS-4820</h2><p>Graph lens: all relationships · synthetic source blend</p></div><div className="graph-toolbar"><Badge tone="cyan">Live lens</Badge><button className="icon-button"><SlidersHorizontal size={15} /></button></div></div><GraphCanvas selectedId={selectedId} onSelect={setSelectedId} /></article><div className="graph-side"><SelectedNode node={selected} onRun={onRun} /><article className="panel graph-query-panel"><SectionKicker icon={Command}>Query context</SectionKicker><div className="query-line"><Search size={14} /><span>Show what changed for NSS-4820</span><kbd>⌘ K</kbd></div><div className="query-tags"><Badge tone="cyan" subtle>product</Badge><Badge tone="red" subtle>changes</Badge><Badge tone="amber" subtle>suppliers</Badge></div><button className="full-button" onClick={() => onRun("Natural-language graph query executed")}>Run agent query <Zap size={14} /></button></article></div></div><article className="panel timeline-wide"><div className="panel-head"><div><SectionKicker icon={History}>Temporal graph</SectionKicker><h2>State transition history</h2><p>The trace is a sequence, not just a snapshot.</p></div><span className="timeline-range">2024 <ArrowUpRight size={13} /> 2026</span></div><div className="temporal-events-wide">{timelineEvents.map((event) => <div className={`wide-event wide-${event.type}`} key={event.id}><div className="wide-event-dot" /><span>{event.date}</span><strong>{event.title}</strong><small>{event.actor}</small><p>{event.detail}</p></div>)}</div></article></div>;
}

function EvidenceView({ onRun }: { onRun: (label: string) => void }) {
  return <div className="view-stack"><div className="view-title-row"><div><SectionKicker icon={FileCheck2}>Evidence register</SectionKicker><h1>Every signal has a source, a freshness, and a confidence.</h1><p>Navigate the records behind agent recommendations and audit conclusions.</p></div><button className="primary-button" onClick={() => onRun("Evidence sync requested · 84,951 records")}> <RefreshCw size={15} />Sync sources</button></div><article className="panel table-panel"><div className="table-toolbar"><div className="table-search"><Search size={15} /><span>Search evidence, source, entity…</span></div><div className="table-actions"><Badge tone="cyan">84,951 indexed</Badge><button className="ghost-button"><SlidersHorizontal size={14} />Filters</button></div></div><div className="data-table"><div className="table-head"><span>Evidence</span><span>Type / source</span><span>Linked context</span><span>Freshness</span><span>Confidence</span><span>State</span></div>{evidence.map((item) => <button className="table-row" key={item.id} onClick={() => onRun(`${item.id} opened · provenance panel ready`)}><span className="table-entity"><span className="table-icon"><FileCheck2 size={14} /></span><span><strong>{item.id}</strong><small>{item.title}</small></span></span><span><b>{item.type}</b><small>{item.source}</small></span><span className="linked-context"><Link2 size={12} />{item.linkedTo}</span><span>{item.freshness}</span><span className="confidence"><i><span style={{ width: `${item.confidence * 100}%` }} /></i>{Math.round(item.confidence * 100)}%</span><Badge tone={item.state === "Current" ? "green" : item.state === "Review due" ? "amber" : "blue"} subtle>{item.state}</Badge></button>)}</div></article><div className="evidence-callout"><div className="callout-icon"><Sparkles size={17} /></div><div><strong>Agent evidence note</strong><p>EV-803 is the only item below 80% confidence in the current audit chain. The weak confidence comes from a missing supplier heat-lot join, not from a failed test result.</p></div><button className="text-button" onClick={() => onRun("Evidence note copied to audit context")}>Add to audit <ChevronRight size={14} /></button></div></div>;
}

function ControlView({ onRun }: { onRun: (label: string) => void }) {
  return <div className="view-stack"><div className="view-title-row"><div><SectionKicker icon={ShieldCheck}>Control coverage</SectionKicker><h1>Know which controls are healthy before the audit asks.</h1><p>Coverage is calculated from linked evidence, findings, and source freshness.</p></div><button className="primary-button" onClick={() => onRun("Control gap scan completed · 2 watch items")}> <Radar size={15} />Run gap scan</button></div><div className="control-grid">{controls.map((control) => <ControlCard key={control.id} control={control} onRun={onRun} />)}</div><article className="panel control-map"><div className="panel-head"><div><SectionKicker icon={Waypoints}>Coverage map</SectionKicker><h2>Where assurance is thin</h2><p>The biggest gap is the supplier-to-product change path.</p></div><Badge tone="amber">2 areas to watch</Badge></div><div className="coverage-map"><div className="coverage-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>{controls.map((control) => <div className="coverage-row" key={control.id}><span>{control.id}</span><div className="coverage-track"><div style={{ width: `${control.coverage}%`, background: toneColor[control.status === "Healthy" ? "green" : control.status === "Gap" ? "red" : "amber"] }} /><i style={{ left: `${control.coverage}%` }} /></div><strong>{control.coverage}%</strong><small>{control.next}</small></div>)}</div></article></div>;
}

function ControlCard({ control, onRun }: { control: ControlRecord; onRun: (label: string) => void }) {
  const tone = control.status === "Healthy" ? "green" : control.status === "Gap" ? "red" : "amber";
  return <button className="control-card" onClick={() => onRun(`${control.id} opened · ${control.next}`)}><div className="control-card-head"><span className="control-id">{control.id}</span><Badge tone={tone} subtle>{control.status}</Badge></div><strong>{control.title}</strong><small>{control.family}</small><div className="control-meter"><div><span style={{ width: `${control.coverage}%`, background: toneColor[tone] }} /></div><b>{control.coverage}%</b></div><p><StatusDot tone={tone} />{control.signal}</p><span className="control-next">Next: {control.next}<ChevronRight size={13} /></span></button>;
}

function DataView({ onRun, connected }: { onRun: (label: string) => void; connected: boolean }) {
  return <div className="view-stack"><div className="view-title-row"><div><SectionKicker icon={DatabaseZap}>Data plane & MCP</SectionKicker><h1>One callable surface for every assurance signal.</h1><p>Synthetic adapters today; client-owned systems can replace each source without changing the graph contract.</p></div><Badge tone={connected ? "green" : "amber"}>{connected ? "MCP surface connected" : "Local demo surface"}</Badge></div><div className="data-view-grid"><article className="panel source-panel"><div className="panel-head"><div><h2>Connected sources</h2><p>Freshness and adapter state</p></div><button className="icon-button" onClick={() => onRun("Source health refreshed")}> <RefreshCw size={15} /></button></div><div className="source-list">{sources.map((source) => <div className="source-row" key={source.name}><div className="source-icon"><ServerCog size={15} /></div><div className="source-copy"><strong>{source.name}</strong><small>{source.kind} <span>·</span> {source.records} records</small></div><div className="source-freshness"><span><StatusDot tone={source.status === "Healthy" ? "green" : source.status === "Watch" ? "amber" : "blue"} />{source.status}</span><small>{source.freshness}</small></div><ChevronRight size={14} /></div>)}</div><div className="synthetic-note"><TriangleAlert size={14} /><span>All records in this workspace are synthetic and safe for demonstration. No client system is connected.</span></div></article><article className="panel mcp-panel"><div className="panel-head"><div><SectionKicker icon={Workflow}>MCP-style tool catalog</SectionKicker><h2>Callable assurance tools</h2><p>Typed, explainable actions for future agents and integrations.</p></div><Badge tone="cyan">{mcpTools.length} tools</Badge></div><div className="tool-list">{mcpTools.map((tool) => <button className="tool-row" key={tool.name} onClick={() => onRun(`${tool.name} executed · synthetic response ready`)}><div className="tool-name"><span className="tool-mark"><Command size={12} /></span><strong>{tool.name}</strong><small>{tool.group}</small></div><p>{tool.description}</p><ArrowUpRight size={14} /></button>)}</div></article></div><div className="api-contract"><div><span className="tiny-label">Integration boundary</span><strong>/api/mcp/call</strong><p>POST a tool name and arguments; the response preserves source provenance, graph relationships, and human-review state.</p></div><div className="contract-code"><span><i>tool</i> trace_product_genealogy</span><span><i>productId</i> NSS-4820</span><span><i>mode</i> synthetic → replaceable adapter</span></div></div></div>;
}

function AppHeader({ view, onNavigate, onRun }: { view: ViewId; onNavigate: (view: ViewId) => void; onRun: (label: string) => void }) {
  const current = navItems.find((item) => item.id === view) ?? navItems[0];
  return <header className="app-header"><div className="breadcrumbs"><span>ASSURANCE OS</span><ChevronRight size={13} /><strong>{current.label}</strong></div><div className="header-actions"><div className="header-search"><Search size={14} /><span>Ask the graph or jump to a record</span><kbd>⌘ K</kbd></div><button className="header-status" onClick={() => onNavigate("data")}><StatusDot tone="green" pulse />5 sources healthy</button><button className="header-alert" onClick={() => onRun("Alert center opened · 4 review items")}><Inbox size={16} /><span>4</span></button><div className="avatar avatar-cream">JL</div></div></header>;
}

export default function Home() {
  const [view, setView] = useState<ViewId>("overview");
  const [toast, setToast] = useState<string | null>(null);
  const [mcpConnected, setMcpConnected] = useState(false);

  useEffect(() => {
    fetch("/api/mcp/tools").then((response) => response.ok ? response.json() : Promise.reject(new Error("MCP unavailable"))).then(() => setMcpConnected(true)).catch(() => setMcpConnected(false));
  }, []);

  const run = (label: string) => {
    setToast(label);
    window.setTimeout(() => setToast(null), 3200);
  };

  const page = useMemo(() => {
    if (view === "overview") return <Overview onNavigate={setView} onRun={run} />;
    if (view === "audit") return <AuditView onRun={run} />;
    if (view === "graph") return <GraphView onRun={run} />;
    if (view === "evidence") return <EvidenceView onRun={run} />;
    if (view === "controls") return <ControlView onRun={run} />;
    return <DataView onRun={run} connected={mcpConnected} />;
  }, [mcpConnected, view]);

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><strong>PART 21</strong><small>ASSURANCE OS</small></div></div><div className="workspace-switcher"><div className="workspace-dot"><MapPin size={13} /></div><div><span>WORKSPACE</span><strong>Northstar / Unit 2</strong></div><ChevronRight size={14} /></div><nav className="side-nav"><span className="nav-heading">OPERATIONS</span>{navItems.slice(0, 5).map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}><Icon size={16} /><span>{item.label}</span>{item.count && <em>{item.count}</em>}</button>; })}<span className="nav-heading nav-heading-data">SYSTEM</span>{navItems.slice(5).map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}><Icon size={16} /><span>{item.label}</span></button>; })}</nav><div className="side-bottom"><div className="environment-card"><div className="environment-top"><StatusDot tone="amber" pulse /><span>DEMO ENVIRONMENT</span></div><p>Synthetic data is active. Connect client adapters when ready.</p><button onClick={() => setView("data")}>View data plane <ArrowUpRight size={13} /></button></div><div className="side-user"><div className="avatar avatar-cream">JL</div><div><strong>Jordan Lewis</strong><small>Assurance architect</small></div><SlidersHorizontal size={14} /></div></div></aside><div className="app-main"><AppHeader view={view} onNavigate={setView} onRun={run} /><main className="main-content"><div className="content-heading"><div><div className="eyebrow"><StatusDot tone="green" pulse />SYSTEM PULSE <span>·</span> {agentPulse.lastRun}</div><h1>{view === "overview" ? "Know what changed. Know why." : navItems.find((item) => item.id === view)?.label}</h1><p>{view === "overview" ? "An explainable assurance layer for products, people, evidence, and change." : "A connected view of assurance evidence, controls, and accountable action."}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => run("Monitoring heartbeat received · 5 adapters responding")}><Activity size={15} />Monitoring live</button><button className="primary-button" onClick={() => run("Agent run queued · selecting best next action")}><Sparkles size={15} />Ask the agents</button></div></div>{page}</main><AgentRail onRun={run} />{toast && <div className="toast"><span className="toast-check"><Check size={13} /></span><span>{toast}</span><button onClick={() => setToast(null)}><X size={13} /></button></div>}</div></div>;
}
