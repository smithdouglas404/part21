import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  getDomainRecordEnvelopeScoped,
  writeDomainRecordWithEvent,
} from "../server/domain-store";

const AUDIT_ID = "AUD-026";
const CARD_ID = "KB-8c203ea0-0bff-49bd-9fc4-c6c03e3075e8";
const FINDING_ID = "F-042";
const ACTOR = "Frank · baseline finding link";

const envelope = await getDomainRecordEnvelopeScoped<Record<string, any>>(
  "kanban_item",
  CARD_ID,
  AUDIT_ID
);
if (!envelope) throw new Error("Findings phase card was not found in AUD-026.");
if (envelope.payload.findingId === FINDING_ID) {
  console.log("Card is already linked to", FINDING_ID);
  process.exit(0);
}

const result = await writeDomainRecordWithEvent(
  {
    recordType: "kanban_item",
    recordId: CARD_ID,
    auditId: AUDIT_ID,
    payload: { ...envelope.payload, findingId: FINDING_ID, attention: true },
  },
  { expectedRevision: envelope.revision, actor: ACTOR },
  {
    id: `EVT-${randomUUID()}`,
    type: "kanban_item_finding_linked",
    actor: ACTOR,
    auditId: AUDIT_ID,
    entityId: CARD_ID,
    payload: {
      findingId: FINDING_ID,
      previousFindingId: envelope.payload.findingId ?? null,
      recordRevision: envelope.revision + 1,
    },
  }
);

console.log(
  JSON.stringify(
    {
      cardId: CARD_ID,
      findingId: result.record.payload.findingId,
      revision: result.record.revision,
      event: result.event.type,
    },
    null,
    2
  )
);
