import { loadCommittedDeadlineEvent, recordDeadlineApplication, recordDeadlineNotice, type DeadlineStoreDependencies } from "../deadline-store";
import type { DeadlineActivities } from "./contracts";
/** Generic optional callbacks are Activities only. Never automate NRC transmissions. */
export function createDeadlineActivities(deps: DeadlineStoreDependencies, callbacks: { onNoticeRecorded?: (notice: Parameters<DeadlineActivities["recordDeadlineNotice"]>[0]) => Promise<void> } = {}): DeadlineActivities {
  return {
    loadCommittedDeadlineEvent: message => loadCommittedDeadlineEvent(message, deps),
    recordDeadlineApplication: (message, result) => recordDeadlineApplication(message, result, deps),
    recordDeadlineNotice: async notice => {
      await recordDeadlineNotice(notice, deps);
      // Injected projections must use the stable audit/case/branch/due/kind operation key for their own idempotency.
      if (callbacks.onNoticeRecorded) await callbacks.onNoticeRecorded(notice);
    },
  };
}
