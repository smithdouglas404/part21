import { useState } from "react";
import {
  Activity,
  Bot,
  CalendarClock,
  ClipboardCheck,
  DatabaseZap,
  FileCheck2,
  FileSearch,
  Gauge,
  Network,
  RefreshCw,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Admin, AdapterOperations, Identity } from "./Admin";
import { Agents } from "./Agents";
import { RbacAdmin } from "./Rbac";
import { Board } from "./Board";
import { Clocks } from "./Clocks";
import {
  Badge,
  Empty,
  EndpointPanel,
  HumanDetail,
  Inspector,
  Panel,
  RecordList,
  ResourceState,
} from "./Common";
import { Governance, Policy, Regulatory } from "./Controlled";
import { Graph } from "./Graph";
import { AuditCreation, Brand } from "./Launch";
import { Documents, Evidence, Reports } from "./Records";
import { GroundedChat, Skills } from "./Skills";
import {
  id,
  label,
  payload,
  record,
  rows,
  scoped,
  storageGet,
  storageSet,
  text,
  useResource,
  type Principal,
  type Row,
} from "./api";

function ControlPolicyCoverage({ auditId }: { auditId: string }) {
  const coverage = useResource(scoped("/api/policy/coverage", auditId));
  const message = coverage.error?.message ?? "";
  const baselineMissing = /No reviewed policy baseline pinned/i.test(message);
  if (coverage.loading)
    return (
      <Panel
        title="Control policy evaluations"
        subtitle={`Audit ${auditId}. Loading the pinned policy revision and rule results.`}
      >
        <ResourceState resource={coverage} />
      </Panel>
    );
  if (baselineMissing)
    return (
      <Panel
        title="Control policy evaluations"
        subtitle={`Audit ${auditId}. The policy library is active, but this audit has no pinned reviewed baseline.`}
      >
        <div className="policy-gate">
          <strong>Control coverage cannot be computed yet</strong>
          <p>
            This screen will not turn descriptive control evidence into a
            coverage percentage, and it will not evaluate controls against an
            unpinned or inferred policy revision. A qualified quality manager
            must pin the exact approved Part 21 policy revision to this audit
            first.
          </p>
          <p>
            What to do next: open Policy as code to see the three confirmations
            the qualified reviewer must record, then return here once the
            baseline is pinned.
          </p>
          <small>
            No pass result, coverage percentage, reportability conclusion or NRC
            notification has been created by this screen.
          </small>
        </div>
      </Panel>
    );
  if (coverage.error)
    return (
      <Panel title="Control policy evaluations">
        <ResourceState resource={coverage} />
      </Panel>
    );
  const results = rows(coverage.data, "results", "rules", "items", "evaluations");
  return (
    <Panel
      title="Control policy evaluations"
      subtitle={`Audit ${auditId}. Deterministic rule results against the pinned reviewed policy revision.`}
    >
      {results.length ? (
        <div className="assurance-record-list">
          {results.map((result, index) => (
            <div className="assurance-record-row" key={text(result.id, String(index))}>
              <span>
                <strong>
                  {text(result.rule?.citation ?? result.citation, "Rule")} ·{" "}
                  {text(result.rule?.title ?? result.title, "Control rule")}
                </strong>
                <small>
                  {text(result.disposition, "unknown").replaceAll("_", " ")} ·{" "}
                  {Array.isArray(result.reasons) && result.reasons.length
                    ? result.reasons.map(String).join(" ")
                    : "No reason text returned; the rule remains open."}
                </small>
              </span>
              <Badge>{text(result.disposition, "unknown")}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <Empty>
          The pinned baseline is available, but no control evaluation has been
          recorded for this audit. Run the policy evaluation from a persisted
          finding; no coverage percentage is inferred from an empty result.
        </Empty>
      )}
    </Panel>
  );
}

const navigation = [
  {
    id: "overview",
    label: "Command center",
    icon: Gauge,
    group: "Command center",
  },
  {
    id: "audit",
    label: "Audit workbench",
    icon: ClipboardCheck,
    group: "Audit execution",
  },
  {
    id: "skills",
    label: "Audit skills",
    icon: Workflow,
    group: "Audit execution",
  },
  {
    id: "governance",
    label: "Human governance",
    icon: Users,
    group: "Audit execution",
  },
  {
    id: "clocks",
    label: "Case clocks",
    icon: CalendarClock,
    group: "Audit execution",
  },
  {
    id: "graph",
    label: "Genealogy graph",
    icon: Network,
    group: "Traceability",
  },
  {
    id: "controls",
    label: "Control coverage",
    icon: ShieldCheck,
    group: "Traceability",
  },
  {
    id: "evidence",
    label: "Evidence register",
    icon: FileCheck2,
    group: "Evidence & reports",
  },
  {
    id: "documents",
    label: "Document control",
    icon: FileSearch,
    group: "Evidence & reports",
  },
  {
    id: "reports",
    label: "Audit reports",
    icon: FileCheck2,
    group: "Evidence & reports",
  },
  {
    id: "policy",
    label: "Policy as code",
    icon: ShieldCheck,
    group: "Evidence & reports",
  },
  {
    id: "regulatory",
    label: "Regulatory sources",
    icon: FileSearch,
    group: "Evidence & reports",
  },
  {
    id: "agents",
    label: "Agent observability",
    icon: Bot,
    group: "Agent operations",
  },
  {
    id: "roles",
    label: "Identity & role lens",
    icon: Users,
    group: "Agent operations",
  },
  {
    id: "data",
    label: "Data plane & MCP",
    icon: DatabaseZap,
    group: "Agent operations",
  },
  {
    id: "rbac",
    label: "Role access (RBAC)",
    icon: ShieldCheck,
    group: "Administration",
  },
  {
    id: "admin",
    label: "Administration",
    icon: Settings,
    group: "Administration",
  },
];
const NAV_AREA: Record<string, string> = {
  overview: "command_center",
  audit: "audit",
  skills: "skills",
  governance: "governance",
  clocks: "clocks",
  graph: "graph",
  controls: "controls",
  evidence: "evidence",
  documents: "documents",
  reports: "reports",
  policy: "policy",
  regulatory: "regulatory",
  agents: "agents",
  roles: "governance",
  data: "data",
  rbac: "admin",
  admin: "admin",
};

function AuditStartPath({
  auditId,
  navigate,
  onAsk,
}: {
  auditId: string;
  navigate: (view: string) => void;
  onAsk: () => void;
}) {
  const library = useResource("/api/nuclear/skills");
  const guide = rows(library.data, "skills").find(
    envelope => id(envelope) === "audit-phases"
  );
  const guidePayload = guide ? payload(guide) : null;
  const phases = guidePayload
    ? Object.entries(guidePayload)
        .filter(
          ([key, value]) =>
            /^\d+$/.test(key) && value && typeof value === "object"
        )
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, value]) => value as Row)
    : [];
  const cards = useResource(scoped("/api/kanban", auditId));
  const baselineCards = rows(cards.data, "items", "cards")
    .map(payload)
    .filter(card =>
      String(card.sourceRecordId ?? "").startsWith("AUDIT-BASELINE:")
    )
    .sort(
      (a, b) =>
        (Number.parseInt(String(a.title), 10) || 0) -
        (Number.parseInt(String(b.title), 10) || 0)
    );
  const skillNames = new Map(
    rows(library.data, "skills").map(envelope => [
      id(envelope),
      label(payload(envelope)),
    ])
  );
  const openPhase = (phase: Row, index: number) => {
    const card =
      baselineCards[index] ??
      baselineCards.find(item => text(item.baselinePhase) === id(phase));
    if (card) storageSet(`assurance-card:${auditId}`, id(card));
    navigate("audit");
  };
  return (
    <section className="audit-start-panel">
      <div className="audit-start-copy">
        <span className="tiny-label">NEW TO THIS AUDIT? START HERE</span>
        <h2>Five phases. A governed skill at every step.</h2>
        <p>
          Frame the audit, pull evidence, trace the chain, evaluate findings,
          then review and close. Open a phase below to work its baseline card in
          the audit workbench; the card carries the skill, the questions and the
          evidence it expects.
        </p>
      </div>
      <div className="audit-phase-path">
        {phases.map((phase, index) => (
          <button
            className="audit-phase-step"
            key={id(phase) || index}
            onClick={() => openPhase(phase, index)}
          >
            <span>{index + 1}</span>
            <strong>{label(phase)}</strong>
            <small>{text(phase.description, "Controlled phase")}</small>
            <em>
              {skillNames.get(text(baselineCards[index]?.activeSkillId)) ||
                "Governed skill attached"}
            </em>
          </button>
        ))}
        {!phases.length && (
          <small>
            {library.loading
              ? "Loading the controlled phase guide…"
              : "The controlled phase guide is unavailable. Open the audit skills library to inspect the configured skills."}
          </small>
        )}
      </div>
      <div className="assurance-inline">
        <button className="primary-button" onClick={() => navigate("audit")}>
          Open the audit workbench
        </button>
        <button className="ghost-button" onClick={() => navigate("skills")}>
          Browse the skill library
        </button>
        <button className="ghost-button" onClick={onAsk}>
          Ask the live agent
        </button>
      </div>
    </section>
  );
}

function Overview({
  auditId,
  audit,
  portfolio,
  lens,
  navigate,
  onInspect,
  onAsk,
}: {
  auditId: string;
  audit: Row;
  portfolio: Row;
  lens: Row;
  navigate: (view: string) => void;
  onInspect: (title: string, data: unknown) => void;
  onAsk: () => void;
}) {
  const findings = rows(portfolio.findings);
  const evidence = rows(portfolio.evidence);
  const metrics = record(portfolio.metrics);
  const readiness = metrics.readiness;
  const findingCount = findings.filter(
    f =>
      !["closed", "resolved", "complete", "approved"].includes(
        String(f.status ?? "").toLowerCase()
      )
  ).length;
  const metricCards = [
    {
      title: "Recorded audit readiness",
      value:
        readiness === undefined || readiness === null
          ? "Unknown"
          : text(readiness),
      detail: "Source-provided metric only; inspect exact basis.",
      data: {
        summary: `Recorded readiness for ${auditId} is ${readiness ?? "unknown"}.`,
        narrative:
          "This is the value persisted in the audit metric record. It is an indicator of how much of the audit evidence and review work is complete, not a certification that the audited activity complies with 10 CFR Part 21 or Appendix B. The report and the underlying findings remain the authoritative record.",
        readinessBasis:
          metrics.readinessBasis ??
          metrics.formula ??
          "The database does not record a separate calculation formula for this metric. Treat it as a source-provided indicator and inspect the linked findings, evidence and controls before relying on it.",
        auditId,
      },
    },
    {
      title: "Unresolved / unclassified findings",
      value: String(findingCount),
      detail: "Returned records not marked closed/resolved/complete/approved.",
      data: {
        summary: `${findingCount} finding${findingCount === 1 ? "" : "s"} remain unresolved or unclassified in ${auditId}.`,
        narrative:
          "A finding is counted here when its recorded status is not closed, resolved, complete or approved. Missing status is treated as unclassified. Each row below is an actual finding record: severity, owner and status come from the database, not from a computed score.",
        auditId,
        countBasis:
          "Returned findings excluding recorded closed/resolved/complete/approved status; missing status is unclassified",
        findings,
      },
    },
    {
      title: "Registered evidence",
      value: String(evidence.length),
      detail: "Count of actual evidence records in this audit.",
      data: {
        summary: `${evidence.length} evidence record${evidence.length === 1 ? "" : "s"} are registered for ${auditId}.`,
        narrative:
          "Registration means the record exists in this audit's evidence register. It does not mean the evidence has been accepted, is sufficient, or has been bound to a finding. Open any row below to see its source, state, confidence and linkage.",
        auditId,
        evidence,
      },
    },
    {
      title: "Linked suppliers",
      value: String(rows(portfolio.suppliers).length),
      detail: "Linked records—not a computed supplier-risk score.",
      data: {
        summary: `${rows(portfolio.suppliers).length} supplier record${rows(portfolio.suppliers).length === 1 ? " is" : "s are"} linked to ${auditId}.`,
        narrative:
          "This is a count of linked supplier records. It is not a supplier-risk score and it does not imply that the supplier is approved or performing. The records below carry the actual status and description.",
        auditId,
        suppliers: portfolio.suppliers ?? [],
      },
    },
  ];
  return (
    <div className="view-stack">
      <AuditStartPath auditId={auditId} navigate={navigate} onAsk={onAsk} />
      <div className="persona-focus-strip">
        <div>
          <span className="tiny-label">PERSONA LENS · NOT AUTHORIZATION</span>
          <strong>{label(lens)}</strong>
          <p>{text(lens.description, "")}</p>
        </div>
        <div className="persona-focus-list">
          {Array.isArray(lens.focus) &&
            lens.focus.map((focus: any, index: number) => (
              <Badge key={index}>{text(focus)}</Badge>
            ))}
        </div>
      </div>
      <div className="metric-grid">
        {metricCards.map(metric => (
          <motion.div
            key={metric.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card
              className="metric-card metric-card-action"
              role="button"
              tabIndex={0}
              onClick={() => onInspect(metric.title, metric.data)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ")
                  onInspect(metric.title, metric.data);
              }}
            >
              <div className="metric-top">
                <Activity size={16} />
                <span className="metric-label">{metric.title}</span>
              </div>
              <div className="metric-value-row">
                <strong>{metric.value}</strong>
              </div>
              <div className="metric-detail">{metric.detail}</div>
            </Card>
          </motion.div>
        ))}
      </div>
      <div className="overview-grid">
        <Panel
          title="Audit profile"
          subtitle={`${label(audit)} · ${id(audit)} · ${text(audit.standard, "Standard not recorded")}`}
          actions={
            <button className="ghost-button" onClick={() => navigate("audit")}>
              Open workbench
            </button>
          }
        >
          <div className="assurance-inline">
            <Badge>{text(audit.status)}</Badge>
            <span>
              Owner {text(audit.owner, "Not recorded")} · due {text(audit.due)}
            </span>
          </div>
          <HumanDetail
            value={{
              ...audit,
              findings: findings.length,
              evidence: `${evidence.length} registered`,
            }}
          />
          <div className="assurance-inline">
            <button className="ghost-button" onClick={() => navigate("graph")}>
              Explore actual graph
            </button>
            <button className="ghost-button" onClick={() => navigate("clocks")}>
              Inspect case clocks
            </button>
            <button
              className="ghost-button"
              onClick={() => navigate("reports")}
            >
              Review report / approvals
            </button>
          </div>
        </Panel>
        <Panel
          title="Finding queue"
          subtitle="Select actual records to inspect; no recommendation, default finding or legal conclusion is inferred."
        >
          <RecordList
            data={findings}
            onInspect={row => onInspect(`Finding ${id(row)}`, row)}
          />
        </Panel>
      </div>
      <EndpointPanel
        title="Nuclear service readiness"
        path={scoped("/api/nuclear/status", auditId)}
        subtitle="Actual Temporal, original-record vault and configuration state. Unconfigured services remain visible."
      />
    </div>
  );
}
export function Workspace({
  principal,
  auditId,
  auditList,
  personas,
  lensId,
  onLens,
  onAudit,
  onCreated,
  onLogout,
  refreshSession,
}: {
  principal: Principal;
  auditId: string;
  auditList: Row[];
  personas: Row[];
  lensId: string;
  onLens: (id: string) => void;
  onAudit: (id: string) => void;
  onCreated: (audit: Row) => void;
  onLogout: () => void;
  refreshSession: () => void;
}) {
  const lens = payload(personas.find(p => id(p) === lensId));
  const canSee = (item: { id: string }) => {
    if (item.id === "admin" || item.id === "rbac") return principal.isAdmin;
    const permissions = principal.permissions;
    if (!permissions?.length || permissions.includes("*")) return true;
    const area = NAV_AREA[item.id];
    return !area || permissions.includes(`${area}.read`);
  };
  const [view, setView] = useState(() => {
    const saved = storageGet(`assurance-view:${auditId}`);
    return navigation.some(n => n.id === saved && canSee(n))
      ? saved
      : "overview";
  });
  const [skillFocus, setSkillFocus] = useState("");
  const navigate = (next: string) => {
    if (
      navigation.some(n => n.id === next && canSee(n))
    ) {
      setView(next);
      if (next !== "skills") setSkillFocus("");
      storageSet(`assurance-view:${auditId}`, next);
    }
  };
  const portfolio = useResource(scoped("/api/domain/portfolio", auditId));
  const [findingId, setFindingId] = useState(() =>
    storageGet(`assurance-finding:${auditId}`)
  );
  const [drawer, setDrawer] = useState<"audit" | "chat" | null>(null);
  const [createAudit, setCreateAudit] = useState(false);
  const [inspection, setInspection] = useState<{
    title: string;
    data: unknown;
  } | null>(null);
  const current = navigation.find(n => n.id === view)!;
  const data = record(portfolio.data);
  const returnedAuditId = id(data.audit);
  const findings = rows(data.findings);
  const selectedFinding = findings.find(f => id(f) === findingId);
  const actualFindingId = selectedFinding ? id(selectedFinding) : "";
  const audit = payload(data.audit ?? auditList.find(a => id(a) === auditId));
  const canWrite =
    principal.isAdmin ||
    (principal.access !== "look_only" &&
      principal.auditWriteIds?.includes(auditId) === true);
  const qualified =
    principal.qualified === true &&
    principal.qualifiedAuditIds?.includes(auditId) === true &&
    Boolean(principal.personId);
  const setFinding = (value: string) => {
    setFindingId(value);
    storageSet(`assurance-finding:${auditId}`, value);
  };
  const openInspect = (title: string, value: unknown) =>
    setInspection({ title, data: value });
  const changeLens = (value: string) => {
    onLens(value);
    const selected = payload(personas.find(p => id(p) === value));
    if (selected.defaultView) navigate(selected.defaultView);
  };
  let page;
  if (portfolio.loading || portfolio.error || !portfolio.data)
    page = (
      <Panel title="Load authorized audit context">
        <ResourceState resource={portfolio} />
        {!portfolio.loading && !portfolio.error && (
          <Empty>No portfolio returned. No substitute audit is loaded.</Empty>
        )}
      </Panel>
    );
  else if (returnedAuditId && returnedAuditId !== auditId)
    page = (
      <Empty>
        Portfolio scope mismatch. The returned audit is not the selected audit.
        Operational surfaces are blocked.
      </Empty>
    );
  else if (view === "overview")
    page = (
      <Overview
        auditId={auditId}
        audit={audit}
        portfolio={data}
        lens={lens}
        navigate={navigate}
        onInspect={openInspect}
        onAsk={() => setDrawer("chat")}
      />
    );
  else if (view === "audit")
    page = (
      <div className="view-stack">
        <Board
          auditId={auditId}
          findingId={actualFindingId}
          canWrite={canWrite}
          onSkill={(linked, skillId) => {
            if (linked) setFinding(linked);
            setSkillFocus(skillId ?? "");
            navigate("skills");
          }}
        />
        <Reports
          auditId={auditId}
          principal={principal}
          canWrite={canWrite}
          qualified={qualified}
        />
      </div>
    );
  else if (view === "graph")
    page = (
      <Graph
        auditId={auditId}
        findingId={actualFindingId}
        onNavigate={navigate}
      />
    );
  else if (view === "skills")
    page = (
      <Skills
        auditId={auditId}
        findingId={actualFindingId}
        canWrite={canWrite}
        initialSkillId={skillFocus}
      />
    );
  else if (view === "evidence")
    page = (
      <Evidence
        auditId={auditId}
        findingId={actualFindingId}
        portfolio={data}
        refresh={portfolio.refresh}
        canWrite={canWrite}
      />
    );
  else if (view === "documents")
    page = (
      <Documents auditId={auditId} canWrite={canWrite} qualified={qualified} />
    );
  else if (view === "reports")
    page = (
      <Reports
        auditId={auditId}
        principal={principal}
        canWrite={canWrite}
        qualified={qualified}
      />
    );
  else if (view === "clocks")
    page = <Clocks auditId={auditId} canWrite={canWrite} />;
  else if (view === "controls")
    page = (
      <div className="view-stack">
        <Panel
          title="Actual audit controls"
          subtitle="No percentages or healthy state are inferred from descriptive evidence."
        >
          <RecordList
            data={rows(data.controls)}
            onInspect={row => openInspect(label(row), row)}
          />
        </Panel>
        <ControlPolicyCoverage auditId={auditId} />
      </div>
    );
  else if (view === "policy")
    page = (
      <Policy
        auditId={auditId}
        findingId={actualFindingId}
        canWrite={canWrite}
        isAdmin={principal.isAdmin}
      />
    );
  else if (view === "regulatory")
    page = <Regulatory auditId={auditId} isAdmin={principal.isAdmin} />;
  else if (view === "governance")
    page = <Governance auditId={auditId} qualified={qualified} />;
  else if (view === "roles")
    page = (
      <div className="view-stack">
        <Identity principal={principal} />
        <Panel title="Governed perspective, unchanged permissions">
          <HumanDetail value={personas.find(p => id(p) === lensId)} />
          <button className="ghost-button" onClick={refreshSession}>
            Refresh actual permissions
          </button>
        </Panel>
      </div>
    );
  else if (view === "agents")
    page = (
      <div className="view-stack">
        <GroundedChat
          key={`${auditId}-${actualFindingId}`}
          auditId={auditId}
          findingId={actualFindingId}
        />
        <Agents auditId={auditId} findingId={actualFindingId} />
      </div>
    );
  else if (view === "data")
    page = (
      <div className="view-stack">
        <Panel title="Actual source records">
          <RecordList
            data={rows(data.sources)}
            onInspect={row => openInspect(label(row), row)}
          />
        </Panel>
        <AdapterOperations auditId={auditId} isAdmin={principal.isAdmin} />
      </div>
    );
  else if (view === "rbac")
    page = <RbacAdmin principal={principal} auditId={auditId} />;
  else page = <Admin principal={principal} auditId={auditId} />;
  return (
    <div className="app-shell assurance-shell">
      <aside className="sidebar">
        <Brand />
        <button
          className="workspace-switcher"
          onClick={() => setDrawer("audit")}
        >
          <div className="workspace-dot">
            <ClipboardCheck size={14} />
          </div>
          <div>
            <span>ACTIVE AUDIT</span>
            <strong>{auditId}</strong>
          </div>
        </button>
        <nav className="side-nav">
          {[
            ...new Set(
              navigation
                .filter(canSee)
                .map(n => n.group)
            ),
          ].map(group => (
            <div key={group}>
              <div className="nav-heading">{group}</div>
              {navigation
                .filter(n => n.group === group && canSee(n))
                .map(n => (
                  <button
                    title={n.label}
                    className={`nav-item ${view === n.id ? "active" : ""}`}
                    key={n.id}
                    onClick={() => {
                      setSkillFocus("");
                      navigate(n.id);
                    }}
                  >
                    <n.icon size={15} />
                    <span>{n.label}</span>
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="environment-card">
            <div className="environment-top">
              <ShieldCheck size={13} />
              HUMAN REVIEW REQUIRED
            </div>
            <p>
              Live records and model recommendations are not a compliance
              certification or NRC transmission.
            </p>
          </div>
          <div className="side-user">
            <div>
              <strong>{principal.actor}</strong>
              <small>
                {principal.roleIds?.join(", ") || "No assigned role"}
              </small>
              <button className="text-button" onClick={onLogout}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <div className="breadcrumbs">
            <span>ASSURANCE OS</span>
            <strong>{current.label}</strong>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={() => setDrawer("audit")}>
              Switch audit
            </button>
            <button className="ghost-button" onClick={() => setDrawer("chat")}>
              Ask live agent
            </button>
            <button
              className="icon-button"
              aria-label="Refresh portfolio"
              onClick={portfolio.refresh}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {principal.id === "read-only-visitor" && (
            <div className="read-only-banner">
              <ShieldCheck size={16} />
              <div>
                <strong>Read-only demonstration view</strong>
                <span>
                  You can inspect every record. Adding cards, evidence, stage
                  moves and approvals requires a signed-in identity with a
                  make-changes grant for this audit.
                </span>
              </div>
              <button className="ghost-button" onClick={onLogout}>
                Sign in
              </button>
            </div>
          )}
          <div className="assurance-context-bar">
            <label>
              Persona lens
              <select value={lensId} onChange={e => changeLens(e.target.value)}>
                {personas.map(p => (
                  <option key={id(p)} value={id(p)}>
                    {label(p)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Finding context
              <select
                value={actualFindingId}
                disabled={portfolio.loading || Boolean(portfolio.error)}
                onChange={e => setFinding(e.target.value)}
              >
                <option value="">No finding selected / whole audit</option>
                {findings.map(f => (
                  <option key={id(f)} value={id(f)}>
                    {id(f)} · {label(f)}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <strong>
                {auditId} · {label(audit, "Audit loading")}
              </strong>
              <small>
                {canWrite ? "Make-changes permission" : "Look-only permission"}{" "}
                ·{" "}
                {qualified
                  ? "Qualified for this audit"
                  : "Not qualified for nuclear approval"}{" "}
                · lens is not a permission
              </small>
            </div>
          </div>
          <div className="view-title-row">
            <div>
              <div className="eyebrow">
                {current.group} · AUTHENTICATED AUDIT CONTEXT
              </div>
              <h1>{current.label}</h1>
              <p>{text(audit.scope, "Audit scope has not been recorded.")}</p>
            </div>
          </div>
          {page}
        </main>
      </div>
      {drawer === "chat" && (
        <Inspector
          title="Grounded live audit question"
          onClose={() => setDrawer(null)}
        >
          <GroundedChat
            key={`${auditId}-${actualFindingId}`}
            auditId={auditId}
            findingId={actualFindingId}
          />
        </Inspector>
      )}
      {drawer === "audit" && (
        <Inspector
          title="Switch actual audit context"
          description="Switching remounts operational views, cancels pending reads and reloads portfolio, graph, evidence, cards, clocks and agent context."
          onClose={() => setDrawer(null)}
        >
          <RecordList
            data={auditList}
            onInspect={row => {
              onAudit(id(row));
              setDrawer(null);
            }}
            empty="No authorized audits."
          />
          <button
            className="ghost-button"
            onClick={() => setCreateAudit(!createAudit)}
          >
            Create audit
          </button>
          {createAudit && (
            <AuditCreation
              onCreated={row => {
                onCreated(row);
                setDrawer(null);
              }}
            />
          )}
        </Inspector>
      )}
      {inspection && (
        <Inspector title={inspection.title} onClose={() => setInspection(null)}>
          <HumanDetail value={inspection.data} />
        </Inspector>
      )}
    </div>
  );
}
