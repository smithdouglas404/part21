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
import { RbacAdmin } from "./Rbac";
import { Board } from "./Board";
import { Clocks } from "./Clocks";
import {
  Badge,
  Empty,
  EndpointPanel,
  Inspector,
  Json,
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

function Overview({
  auditId,
  audit,
  portfolio,
  lens,
  navigate,
  onInspect,
}: {
  auditId: string;
  audit: Row;
  portfolio: Row;
  lens: Row;
  navigate: (view: string) => void;
  onInspect: (title: string, data: unknown) => void;
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
        auditId,
        metrics: portfolio.metrics ?? null,
        readinessBasis: metrics.readinessBasis ?? metrics.formula ?? null,
      },
    },
    {
      title: "Unresolved / unclassified findings",
      value: String(findingCount),
      detail: "Returned records not marked closed/resolved/complete/approved.",
      data: {
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
      data: { auditId, evidence },
    },
    {
      title: "Linked suppliers",
      value: String(rows(portfolio.suppliers).length),
      detail: "Linked records—not a computed supplier-risk score.",
      data: { auditId, suppliers: portfolio.suppliers ?? [] },
    },
  ];
  return (
    <div className="view-stack">
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
          title={label(audit)}
          subtitle={`${id(audit)} · ${text(audit.standard, "Standard not recorded")} · ${text(audit.scope, "Scope not recorded")}`}
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
          <Json
            value={audit}
            title="Exact audit profile, scope and record revision"
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
      : navigation.some(n => n.id === lens.defaultView && canSee(n))
        ? String(lens.defaultView)
        : "overview";
  });
  const navigate = (next: string) => {
    if (
      navigation.some(n => n.id === next && canSee(n))
    ) {
      setView(next);
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
      />
    );
  else if (view === "audit")
    page = (
      <div className="view-stack">
        <Board
          auditId={auditId}
          findingId={actualFindingId}
          canWrite={canWrite}
          onSkill={linked => {
            if (linked) setFinding(linked);
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
    page = <Graph auditId={auditId} findingId={actualFindingId} />;
  else if (view === "skills")
    page = (
      <Skills
        auditId={auditId}
        findingId={actualFindingId}
        canWrite={canWrite}
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
        <EndpointPanel
          title="Control policy evaluations"
          path={scoped("/api/policy/coverage", auditId)}
          keys={["results", "rules", "items"]}
        />
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
          <Json value={personas.find(p => id(p) === lensId)} open />
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
        <EndpointPanel
          title="Persisted agent activity"
          path={scoped("/api/agentkit/activity", auditId)}
          keys={["runs", "agents", "activity", "items"]}
        />
        <EndpointPanel
          title="Agent runtime registry"
          path={scoped("/api/agents/registry", auditId)}
          keys={["agents", "runs"]}
          subtitle="Inspect actual runtime state; no fabricated watchers, heartbeats or completed simulations."
        />
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
                    onClick={() => navigate(n.id)}
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
          <Json value={inspection.data} open />
        </Inspector>
      )}
    </div>
  );
}
