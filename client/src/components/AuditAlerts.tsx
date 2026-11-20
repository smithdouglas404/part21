import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, Check, RefreshCw, X } from "lucide-react";

/**
 * Visible surface for the alert engine. The alerts are produced by the agent from persisted
 * audit records; this panel is how a leader actually sees them, reads the narrative, and
 * records an acknowledgement with a rationale.
 */

type Alert = {
  id: string;
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  narrative: string;
  status: "open" | "acknowledged";
  findingId: string | null;
  raisedAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  rationale?: string;
};

const severityStyle: Record<Alert["severity"], string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-black",
  low: "bg-slate-500 text-white",
};

export default function AuditAlerts({ auditId }: { auditId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!auditId) return;
    try {
      const response = await fetch(`/api/alerts?auditId=${encodeURIComponent(auditId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Unable to load alerts");
      setAlerts(Array.isArray(body.alerts) ? body.alerts : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load alerts");
    }
  }, [auditId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const acknowledge = async (alert: Alert) => {
    if (!rationale.trim()) { setError("A rationale is required before acknowledging an alert."); return; }
    setBusy(alert.id);
    try {
      const response = await fetch(`/api/alerts/${encodeURIComponent(alert.id)}/acknowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auditId, actor: "Workspace user", rationale: rationale.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Acknowledgement failed");
      setRationale("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Acknowledgement failed");
    } finally {
      setBusy(null);
    }
  };

  const openAlerts = alerts.filter(alert => alert.status === "open");
  const urgent = openAlerts.some(alert => alert.severity === "critical" || alert.severity === "high");

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[26rem] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle size={15} /> Audit alerts
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{openAlerts.length} open</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="ghost-button" onClick={() => void load()} aria-label="Refresh alerts"><RefreshCw size={13} /></button>
              <button className="ghost-button" onClick={() => setOpen(false)} aria-label="Close alerts"><X size={13} /></button>
            </div>
          </div>

          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          {!alerts.length && <p className="text-sm text-muted-foreground">No alerts have been raised for this audit. The engine evaluates findings, evidence, changes and precedent coverage.</p>}

          <div className="space-y-3">
            {alerts.map(alert => (
              <div key={alert.id} className={`rounded-lg border p-3 ${alert.status === "acknowledged" ? "border-border opacity-70" : "border-border"}`}>
                <div className="mb-1 flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityStyle[alert.severity]}`}>{alert.severity}</span>
                  <span className="text-xs text-muted-foreground">{alert.code}{alert.findingId ? ` · ${alert.findingId}` : ""}</span>
                </div>
                <p className="text-sm font-medium">{alert.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{alert.narrative}</p>
                {alert.status === "acknowledged" ? (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-600">
                    <Check size={12} /> Acknowledged by {alert.acknowledgedBy}{alert.rationale ? ` — ${alert.rationale}` : ""}
                  </p>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                      placeholder="Rationale for acknowledgement"
                      value={rationale}
                      onChange={event => setRationale(event.target.value)}
                    />
                    <button className="ghost-button text-xs" disabled={busy === alert.id} onClick={() => void acknowledge(alert)}>
                      {busy === alert.id ? "Saving…" : "Acknowledge"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(value => !value)}
        className={`relative flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition ${urgent ? "bg-red-600 text-white" : "bg-slate-800 text-white"}`}
        aria-label="Audit alerts"
      >
        <Bell size={22} />
        {openAlerts.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-red-600 ring-2 ring-red-600">
            {openAlerts.length}
          </span>
        )}
      </button>
    </div>
  );
}
