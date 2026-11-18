import { useEffect, useState } from "react";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Admin } from "@/components/assurance/Admin";
import {
  Empty,
  ErrorNotice,
  Inspector,
  Panel,
  ResourceState,
} from "@/components/assurance/Common";
import { Brand, Launch } from "@/components/assurance/Launch";
import { Workspace } from "@/components/assurance/Workspace";
import {
  ApiError,
  id,
  rows,
  storageGet,
  storageSet,
  useConfigurations,
  useResource,
  type Principal,
  type Row,
} from "@/components/assurance/api";
import "@/components/assurance/assurance.css";

function AuthenticatedHome({
  principal,
  onLogout,
  refreshSession,
}: {
  principal: Principal;
  onLogout: () => void;
  refreshSession: () => void;
}) {
  const audits = useResource("/api/domain/audits");
  const personas = useConfigurations("persona");
  const prefix = `assurance:${principal.id}`;
  const [auditId, setAuditId] = useState(() => storageGet(`${prefix}:audit`));
  const [lensId, setLensId] = useState(() => storageGet(`${prefix}:lens`));
  const [entered, setEntered] = useState(
    () => storageGet(`${prefix}:entered`) === "true"
  );
  const [admin, setAdmin] = useState(false);
  const list = rows(audits.data, "audits").filter(
    row =>
      principal.isAdmin ||
      !Array.isArray(principal.auditIds) ||
      principal.auditIds.includes(id(row)) ||
      principal.auditIds.includes(String(row.auditId ?? ""))
  );
  const validAudit = list.some(row => id(row) === auditId);
  const validLens = personas.data.some(row => id(row) === lensId);
  const onAudit = (value: string) => {
    setAuditId(value);
    storageSet(`${prefix}:audit`, value);
  };
  const onLens = (value: string) => {
    setLensId(value);
    storageSet(`${prefix}:lens`, value);
  };
  const onCreated = (audit: Row) => {
    onAudit(id(audit));
    audits.refresh();
  };
  if (
    entered &&
    ((audits.loading && audits.data == null) ||
      (personas.loading && personas.data == null))
  )
    return (
      <div className="launch-shell">
        <main className="launch-content">
          <Panel title="Reloading authenticated workspace">
            <ResourceState resource={audits} />
            <ResourceState resource={personas} />
          </Panel>
        </main>
      </div>
    );
  if (entered && (audits.error || personas.error))
    return (
      <div className="launch-shell">
        <main className="launch-content">
          <Panel
            title="Authenticated scope could not be loaded"
            subtitle="The workspace is blocked rather than entering with a stale lens or audit list."
          >
            <ResourceState resource={audits} />
            <ResourceState resource={personas} />
          </Panel>
        </main>
      </div>
    );
  if (entered && validAudit && validLens)
    return (
      <Workspace
        key={auditId}
        principal={principal}
        auditId={auditId}
        auditList={list}
        personas={personas.data}
        lensId={lensId}
        onLens={onLens}
        onAudit={onAudit}
        onCreated={onCreated}
        onLogout={onLogout}
        refreshSession={refreshSession}
      />
    );
  return (
    <>
      <div className="assurance-launch-actions">
        <button className="ghost-button" onClick={refreshSession}>
          <RefreshCw size={13} />
          Refresh session / scope
        </button>
        {principal.isAdmin && (
          <button className="ghost-button" onClick={() => setAdmin(true)}>
            Access & configuration administration
          </button>
        )}
        <button className="ghost-button" onClick={onLogout}>
          Sign out
        </button>
      </div>
      <Launch
        principal={principal}
        audits={audits}
        personas={personas}
        selectedAudit={auditId}
        selectedLens={lensId}
        onAudit={onAudit}
        onLens={onLens}
        onCreated={onCreated}
        refreshAudits={audits.refresh}
        onEnter={() => {
          setEntered(true);
          storageSet(`${prefix}:entered`, "true");
        }}
      />
      {entered &&
        (!validAudit || !validLens) &&
        !audits.loading &&
        !personas.loading && (
          <div className="assurance-scope-notice">
            The saved audit or persona is no longer available. Select an
            authorized audit and active lens; no fallback context is used.
          </div>
        )}
      {!principal.isAdmin &&
        !audits.loading &&
        !audits.error &&
        !list.length && (
          <div className="assurance-scope-notice">
            No audit scope is granted to principal {principal.id}. Ask an
            application administrator to issue an explicit audit grant.
            Selecting a lens cannot grant access and a read-only connector
            cannot be elevated.
          </div>
        )}
      {admin && (
        <Inspector
          title="Administrator scope & configuration setup"
          description="No audit is silently selected. Actual directory, grants and immutable configuration revisions only."
          onClose={() => setAdmin(false)}
        >
          <Admin
            principal={principal}
            auditId={validAudit ? auditId : undefined}
          />
        </Inspector>
      )}
    </>
  );
}
export default function Home() {
  const session = useResource<{ principal: Principal; auditIds?: string[] }>(
    "/api/session"
  );
  const [expired, setExpired] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const logout = trpc.auth.logout.useMutation();
  const utilities = trpc.useUtils();
  useEffect(() => {
    const expire = () => setExpired(true);
    window.addEventListener("assurance-session-expired", expire);
    return () =>
      window.removeEventListener("assurance-session-expired", expire);
  }, []);
  const refresh = () => {
    setExpired(false);
    session.refresh();
  };
  const signOut = async () => {
    try {
      await logout.mutateAsync();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      try {
        sessionStorage.removeItem("manus-cookie");
      } catch {}
      utilities.auth.me.setData(undefined, null);
      setExpired(true);
      session.refresh();
    }
  };
  const principal = !expired ? session.data?.principal : null;
  if (principal?.id)
    return (
      <AuthenticatedHome
        key={String(principal.id)}
        principal={principal}
        onLogout={() => void signOut()}
        refreshSession={refresh}
      />
    );
  const unauthorized =
    expired ||
    (session.error instanceof ApiError && session.error.status === 401);
  const configured = Boolean(
    window.__MANUS_CONFIG__?.oauthPortalUrl &&
      window.__MANUS_CONFIG__?.projectId
  );
  return (
    <div className="launch-shell">
      <div className="launch-topbar">
        <Brand />
      </div>
      <main className="launch-content assurance-login">
        <Panel
          title={
            session.loading && !expired
              ? "Checking authenticated session…"
              : unauthorized
                ? "Sign in before opening assurance records."
                : "Authentication service unavailable"
          }
          subtitle="Identity and server-issued audit access are required up front. No anonymous demo, persona-based privilege or static audit fallback is available."
        >
          <LockKeyhole size={28} />
          {!unauthorized && <ErrorNotice error={session.error} />}
          <ErrorNotice error={loginError} />
          {session.loading && !expired ? (
            <Empty>
              Checking the existing cookie / Preview authorization session.
            </Empty>
          ) : (
            <>
              <div className="assurance-inline">
                <button
                  className="primary-button"
                  disabled={!configured}
                  onClick={() => {
                    try {
                      setLoginError(null);
                      startLogin();
                    } catch (error) {
                      setLoginError(
                        error instanceof Error ? error.message : String(error)
                      );
                    }
                  }}
                >
                  Sign in with existing application login
                </button>
                <button className="ghost-button" onClick={refresh}>
                  <RefreshCw size={13} />
                  Retry session
                </button>
              </div>
              {!configured && (
                <Empty>
                  The existing OAuth portal / project configuration is not
                  available. Configure the actual application login; no
                  substitute authentication is provided.
                </Empty>
              )}
              {unauthorized && (
                <p>
                  Anonymous HTTP access is intentionally unavailable. An
                  administrator must grant audit scope after successful
                  authentication.
                </p>
              )}
            </>
          )}
        </Panel>
      </main>
    </div>
  );
}
