import "dotenv/config";
import { buildPrecedentPacket } from "../server/precedent";
import { answerLiveGroundedQuestion } from "../server/ai";

const auditId = process.argv[2] ?? "AUD-026";
const findingId = process.argv[3] ?? "F-042";
const question = process.argv[4] ?? "What does the record show, what have we seen in past audits, and what should I do next?";

(async () => {
  const precedent = await buildPrecedentPacket({ auditId, findingId, question });
  console.log("=== PRECEDENT PACKET ===");
  console.log(JSON.stringify({ scope: precedent.scope, comparable: precedent.comparableFindings, relatedAudits: precedent.relatedAudits, coverageGap: precedent.coverageGap, coverageStatement: precedent.coverageStatement }, null, 2));

  const principal = { id: "verification-principal", actor: "Verification run", auditIds: [auditId], auditWriteIds: [auditId], access: "make_changes" as const, isAdmin: false, roleIds: [], qualified: false };
  console.log("\n=== LIVE AGENT ===");
  const result: any = await answerLiveGroundedQuestion(question, auditId, findingId, { principal, skillId: "finding-challenge" });
  console.log("llmInvoked:", result.llmInvoked, "| model:", result.model, "| provider:", result.provider);
  console.log("narrative:", JSON.stringify(result.narrative ?? null));
  console.log("precedent cited in packet:", result.precedentTraversal?.coverageStatement ?? "none");
  console.log("\n--- ANSWER ---\n" + result.answer);
  process.exit(0);
})().catch(error => { console.error("FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
