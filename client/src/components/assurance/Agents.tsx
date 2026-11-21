import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  ListChecks,
  MessageSquare,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { Badge, Empty, Json, Panel, ResourceState } from "./Common";
import {
  formatWhen,
  rows,
  scoped,
  text,
  useResource,
  type Row,
} from "./api";

function agentStateLabel(state: unknown) {
  const value = text(state, "not_dispatched");
  if (value === "not_dispatched") return "Configured";
  return value.replaceAll("_", " ");
}

function runStatusLabel(status: unknown) {
  const value = text(status, "unknown");
  if (value === "ready_for_human_gate") return "Ready for human gate";
  if (value === "needs_more_context") return "More context required";
  if (value === "draft_preview") return "Draft preview";
  if (value === "running") return "Running";
  if (value === "failed") return "Failed";
  return value.replaceAll("_", " ");
}

function runNarrative(run: Row) {
  const skill = text(
    run.appliedSkill?.name ?? run.skillId,
    "Governed assurance skill"
  );
  const started = formatWhen(run.startedAt, "an unrecorded time");
  const tools = Array.isArray(run.toolCalls) ? run.toolCalls.length : 0;
  const completion = Number(run.completion ?? 0);
  const status = runStatusLabel(run.status);
  const gate = text(
    run.humanGate?.gate ?? run.humanGate,
    "Qualified human review"
  ).replace(/\.$/, "");
  const unknowns = Array.isArray(run.unknowns) ? run.unknowns : [];
  return [
    `${skill} ran for ${text(run.auditId, "the selected audit")} on ${started}.`,
    `The run ended in the state "${status}" with ${completion}% of its required questions answered and ${tools} persisted tool ${tools === 1 ? "call" : "calls"}.`,
    unknowns.length
      ? `The agent explicitly recorded ${unknowns.length} unresolved ${unknowns.length === 1 ? "item" : "items"}; they are listed below rather than treated as a conclusion.`
      : "No unresolved context was recorded, but the output remains a recommendation until a qualified person accepts it.",
    `The human gate is still pending: ${gate}. No regulatory verdict or approval was issued by the agent.`,
  ].join(" ");
}

function agentRunsFor(runs: Row[], agent: Row) {
  return runs.filter(
    run =>
      text(run.agent) === text(agent.agentId) ||
      text(run.skillId) === text(agent.agentId)
  );
}

export function Agents({
  auditId,
  findingId,
}: {
  auditId: string;
  findingId: string;
}) {
  const registry = useResource(scoped("/api/agents/registry", auditId));
  const activity = useResource(scoped("/api/agentkit/activity", auditId));
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const agents = rows(registry.data, "agents");
  const runs = rows(activity.data, "agents", "runs", "activity", "items");
  const selectedAgent = selectedAgentId
    ? agents.find(agent => text(agent.agentId) === selectedAgentId) ?? null
    : null;
  const visibleRuns = selectedAgent
    ? agentRunsFor(runs, selectedAgent)
    : runs;
  const selectedRun = selected
    ? visibleRuns.find(run => text(run.traceId) === text(selected.traceId)) ??
      selected
    : null;

  const chooseAgent = (agent: Row) => {
    const agentId = text(agent.agentId);
    setSelectedAgentId(current => (current === agentId ? "" : agentId));
    setSelected(null);
  };

  return (
    <div className="view-stack">
      <section className="agent-page-intro">
        <div>
          <span className="tiny-label">HOW TO READ THIS PAGE</span>
          <h2>What the agents are, and what they actually did</h2>
          <p>
            This page separates a governed agent configuration from a real
            execution. A configured agent exists in the audit's active skill
            configuration. A run exists only when a card skill was executed and
            its trace was persisted. Select any agent below to read its purpose,
            its human gate, and every run it has produced for this audit.
          </p>
        </div>
        <div className="agent-intro-steps">
          <div>
            <b>1</b>
            <span>
              <strong>Configured</strong>
              <small>
                The governed agent and exact skill revision are active for this
                audit.
              </small>
            </span>
          </div>
          <div>
            <b>2</b>
            <span>
              <strong>Run</strong>
              <small>
                A card skill was answered and executed; the tool calls and trace
                were persisted.
              </small>
            </span>
          </div>
          <div>
            <b>3</b>
            <span>
              <strong>Human gate</strong>
              <small>
                A qualified person must accept the result. The agent never
                issues the final regulatory decision.
              </small>
            </span>
          </div>
        </div>
      </section>

      <Panel
        title="Assurance agents"
        subtitle={`Audit ${auditId}. ${agents.length} governed agents are configured; ${runs.length} persisted runs are recorded. Select an agent to see what it does and what it has done.`}
        actions={
          <Badge>
            {agents.length} configured · {runs.length} runs
          </Badge>
        }
      >
        <ResourceState resource={registry} />
        {!registry.loading && !registry.error && !agents.length && (
          <Empty>No governed agent configuration is active for this audit.</Empty>
        )}
        <div className="agent-registry-grid">
          {agents.map(agent => {
            const agentRuns = agentRunsFor(runs, agent);
            const active = text(agent.agentId) === selectedAgentId;
            return (
              <article
                className={`agent-card ${active ? "active" : ""}`}
                key={text(agent.agentId)}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`${text(agent.name, text(agent.agentId))}. Select to view purpose and runs.`}
                onClick={() => chooseAgent(agent)}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    chooseAgent(agent);
                  }
                }}
              >
                <div className="agent-card-top">
                  <span className="agent-avatar">
                    <Bot size={16} />
                  </span>
                  <div>
                    <strong>{text(agent.name, text(agent.agentId))}</strong>
                    <small>{text(agent.agentId)}</small>
                  </div>
                  <span className="agent-state">
                    {agentStateLabel(agent.state)}
                  </span>
                </div>
                <p className="agent-purpose">
                  {text(agent.purpose, "Purpose text is not recorded for this agent.")}
                </p>
                <div className="agent-card-meta">
                  <span>
                    <Workflow size={12} /> {text(agent.phase, "phase not recorded")}
                  </span>
                  <span>
                    <MessageSquare size={12} />{" "}
                    {text(agent.questionCount, "0")} questions
                  </span>
                  <span>
                    <CircleDashed size={12} /> {agentRuns.length}{" "}
                    {agentRuns.length === 1 ? "run" : "runs"}
                  </span>
                </div>
                <div className="agent-card-foot">
                  <span>
                    <ShieldCheck size={12} /> human gate required
                  </span>
                  <span className="agent-select-hint">
                    {active ? "Selected" : "Select to inspect"}{" "}
                    <ChevronRight size={13} />
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </Panel>

      {selectedAgent && (
        <Panel
          title={text(selectedAgent.name, text(selectedAgent.agentId))}
          subtitle={`Agent ${text(selectedAgent.agentId)} · configured from ${text(selectedAgent.configurationVersion, "a governed revision")}`}
          actions={
            <button
              className="ghost-button"
              onClick={() => {
                setSelectedAgentId("");
                setSelected(null);
              }}
            >
              Show all agents
            </button>
          }
        >
          <p className="agent-purpose-full">
            {text(
              selectedAgent.purpose,
              "No purpose text is recorded for this agent."
            )}
          </p>
          <div className="agent-detail-grid">
            <div>
              <span className="tiny-label">ROUTE</span>
              <code>{text(selectedAgent.route)}</code>
            </div>
            <div>
              <span className="tiny-label">PHASE</span>
              <strong>{text(selectedAgent.phase, "Not recorded")}</strong>
            </div>
            <div>
              <span className="tiny-label">HUMAN GATE</span>
              <small>
                {text(selectedAgent.humanGate, "Qualified review required")}
              </small>
            </div>
            <div>
              <span className="tiny-label">REGULATORY BASIS</span>
              <small>
                {Array.isArray(selectedAgent.regulatoryRefs) &&
                selectedAgent.regulatoryRefs.length
                  ? selectedAgent.regulatoryRefs.map(String).join(", ")
                  : "No regulatory reference returned"}
              </small>
            </div>
          </div>
          <div className="agent-detail-runs">
            <div className="agent-detail-runs-head">
              <h3>What this agent has done in {auditId}</h3>
              <Badge>{agentRunsFor(runs, selectedAgent).length} runs</Badge>
            </div>
            {agentRunsFor(runs, selectedAgent).length ? (
              <div className="agent-run-list">
                {agentRunsFor(runs, selectedAgent)
                  .slice(0, 8)
                  .map(run => (
                    <button
                      className={`agent-run-card ${selectedRun && text(selectedRun.traceId) === text(run.traceId) ? "active" : ""}`}
                      key={text(run.traceId)}
                      onClick={() => setSelected(run)}
                    >
                      <span className="agent-run-icon">
                        {run.status === "ready_for_human_gate" ? (
                          <CheckCircle2 size={15} />
                        ) : (
                          <Clock3 size={15} />
                        )}
                      </span>
                      <span>
                        <strong>
                          {text(
                            run.appliedSkill?.name ?? run.skillId,
                            "Governed skill run"
                          )}
                        </strong>
                        <small>
                          {runStatusLabel(run.status)} ·{" "}
                          {formatWhen(run.startedAt, "start time not recorded")} ·
                          trace {text(run.traceId)}
                        </small>
                      </span>
                      <span className="agent-run-meta">
                        {Number(run.completion ?? 0)}% ·{" "}
                        {Array.isArray(run.toolCalls)
                          ? run.toolCalls.length
                          : 0}{" "}
                        tools
                      </span>
                    </button>
                  ))}
              </div>
            ) : (
              <Empty>
                This agent is configured, but it has no persisted run for{" "}
                {auditId}. Open a Kanban card, answer the governed questions and
                run the skill check to create a trace.
              </Empty>
            )}
          </div>
        </Panel>
      )}

      <Panel
        title={
          selectedAgent
            ? `Run history · ${text(selectedAgent.name)}`
            : "Agent activity and traceability"
        }
        subtitle={
          selectedAgent
            ? `Only persisted runs for ${text(selectedAgent.name)} are shown. Select a run to read the narrative, tool calls and open questions.`
            : "Every row is a persisted execution record. Select one to read what the agent did, which tools it called and what remains unresolved."
        }
        actions={
          selectedAgent ? (
            <button
              className="ghost-button"
              onClick={() => {
                setSelectedAgentId("");
                setSelected(null);
              }}
            >
              Show all runs
            </button>
          ) : (
            <Badge>{runs.length} runs</Badge>
          )
        }
      >
        <ResourceState resource={activity} />
        {!activity.loading && !activity.error && !visibleRuns.length && (
          <Empty>
            {selectedAgent
              ? `No persisted run exists for ${text(selectedAgent.name)} in ${auditId}.`
              : "No agent has run for this audit yet. Start a card, answer its skill questions and run the skill check to create a durable trace."}
          </Empty>
        )}
        <div className="agent-run-list">
          {visibleRuns.slice(0, 20).map(run => (
            <button
              className={`agent-run-card ${selectedRun && text(selectedRun.traceId) === text(run.traceId) ? "active" : ""}`}
              key={text(run.traceId)}
              onClick={() => setSelected(run)}
            >
              <span className="agent-run-icon">
                {run.status === "ready_for_human_gate" ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <Clock3 size={15} />
                )}
              </span>
              <span>
                <strong>
                  {text(
                    run.appliedSkill?.name ?? run.skillId,
                    "Governed skill run"
                  )}
                </strong>
                <small>
                  {runStatusLabel(run.status)} ·{" "}
                  {formatWhen(run.startedAt, "start time not recorded")} · trace{" "}
                  {text(run.traceId)}
                </small>
              </span>
              <span className="agent-run-meta">
                {Number(run.completion ?? 0)}% ·{" "}
                {Array.isArray(run.toolCalls) ? run.toolCalls.length : 0} tools
              </span>
            </button>
          ))}
        </div>
      </Panel>

      {selectedRun && (
        <Panel
          title="What this agent did"
          subtitle={`Trace ${text(selectedRun.traceId)} · finding ${text(selectedRun.findingId ?? findingId, "audit-level run")}`}
          actions={
            <button className="ghost-button" onClick={() => setSelected(null)}>
              Close trace
            </button>
          }
        >
          <p className="agent-narrative">{runNarrative(selectedRun)}</p>
          <div className="agent-trace-grid">
            <div>
              <span className="tiny-label">SKILL AND REVISION</span>
              <strong>
                {text(
                  selectedRun.appliedSkill?.name ?? selectedRun.skillId,
                  "Governed skill"
                )}
              </strong>
              <small>
                {text(
                  selectedRun.appliedSkill?.version ??
                    selectedRun.skillRevision,
                  "Revision not returned"
                )}
              </small>
            </div>
            <div>
              <span className="tiny-label">HUMAN GATE</span>
              <strong>{text(selectedRun.humanGate?.status, "pending")}</strong>
              <small>
                {text(
                  selectedRun.humanGate?.gate ?? selectedRun.humanGate,
                  "Qualified review required"
                )}
              </small>
            </div>
            <div>
              <span className="tiny-label">GROUNDING</span>
              <strong>
                {selectedRun.grounding?.graphTraversed
                  ? "Graph traversed"
                  : "Audit portfolio only"}
              </strong>
              <small>
                {text(selectedRun.grounding?.nodeCount, "0")} nodes ·{" "}
                {text(selectedRun.grounding?.edgeCount, "0")} edges ·{" "}
                {text(selectedRun.grounding?.temporalEventCount, "0")} temporal
                events
              </small>
            </div>
          </div>
          {Array.isArray(selectedRun.toolCalls) &&
            selectedRun.toolCalls.length > 0 && (
              <div className="agent-tool-list">
                <span className="tiny-label">TOOL CALLS, IN ORDER</span>
                {selectedRun.toolCalls.map((tool: Row, index: number) => (
                  <div
                    className="agent-tool-row"
                    key={text(tool.id, String(index))}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{text(tool.tool)}</strong>
                      <small>
                        {text(tool.status)} ·{" "}
                        {Array.isArray(tool.sourceIds)
                          ? tool.sourceIds.length
                          : 0}{" "}
                        source IDs
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          {Array.isArray(selectedRun.unknowns) &&
            selectedRun.unknowns.length > 0 && (
              <div className="agent-unknowns">
                <span className="tiny-label">UNRESOLVED ITEMS</span>
                {selectedRun.unknowns.map((item: unknown, index: number) => (
                  <p key={index}>{text(item)}</p>
                ))}
              </div>
            )}
          {Array.isArray(selectedRun.followUpQuestions) &&
            selectedRun.followUpQuestions.length > 0 && (
              <div className="agent-unknowns">
                <span className="tiny-label">QUESTIONS STILL OPEN</span>
                {selectedRun.followUpQuestions.map(
                  (item: unknown, index: number) => (
                    <p key={index}>{text(item)}</p>
                  )
                )}
              </div>
            )}
          <details className="technical-details">
            <summary>Technical details (raw execution record)</summary>
            <Json value={selectedRun} />
          </details>
        </Panel>
      )}
    </div>
  );
}
