import { describe, expect, it } from "vitest";
import { loadCommittedDeadlineEvent, recordDeadlineApplication, type DeadlineStoreDependencies } from "./deadline-store";
import type { CaseState, CommittedCaseEvent } from "./temporal/contracts";
const message: CommittedCaseEvent = { auditId: "synthetic-audit", caseId: "synthetic-case", eventId: "synthetic-event", expectedVersion: 0, version: 1, state: {} as CaseState };
function deps(rows: unknown[]): DeadlineStoreDependencies {
  return { pool: { query: async () => [rows] } as unknown as DeadlineStoreDependencies["pool"] };
}
describe("committed event and receipt gates", () => {
  it("rejects a message that differs from the immutable outbox payload", async () => {
    await expect(loadCommittedDeadlineEvent({ ...message, auditId: "other-audit" }, deps([{ payload: JSON.stringify(message) }]))).rejects.toThrow("differs");
  });
  it("rejects a missing committed event instead of inventing application", async () => {
    await expect(loadCommittedDeadlineEvent(message, deps([]))).rejects.toThrow("does not exist");
  });
  it("rejects an application receipt for a different event or revision before any status write", async () => {
    const store = deps([{ payload: JSON.stringify(message) }]);
    await expect(recordDeadlineApplication(message, { eventId: "other-event", version: 1, status: "applied" }, store)).rejects.toThrow("does not match");
    await expect(recordDeadlineApplication(message, { eventId: message.eventId, version: 2, status: "applied" }, store)).rejects.toThrow("does not match");
  });
});
