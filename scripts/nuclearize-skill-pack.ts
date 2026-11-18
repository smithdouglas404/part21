import "dotenv/config";
import { createHash } from "node:crypto";
import { createPool } from "mysql2/promise";

const DOMAIN: Record<string, { domain: string; sections: string[]; criteria: string[] }> = {
  "part21-applicability": { domain: "nuclear-part21", sections: ["21.2", "21.3", "21.21(a)"], criteria: ["I", "II", "III"] },
  "part21-deviation-screening": { domain: "nuclear-part21", sections: ["21.3", "21.21(a)"], criteria: ["III", "V", "X", "XV"] },
  "part21-discovery-clock": { domain: "nuclear-part21", sections: ["21.21(a)", "21.21(c)"], criteria: ["XVII", "XVIII"] },
  "part21-substantial-safety-hazard": { domain: "nuclear-part21", sections: ["21.21(a)", "21.21(b)", "21.21(c)"], criteria: ["III", "XV", "XVI"] },
  "part21-notification": { domain: "nuclear-part21", sections: ["21.21(b)", "21.21(c)", "21.21(d)"], criteria: ["XVII"] },
  "part21-postings-communications": { domain: "nuclear-part21", sections: ["21.7", "21.21(d)"], criteria: ["II", "XVII"] },
  "supplier-evaluation-transfer": { domain: "nuclear-part21", sections: ["21.21(b)"], criteria: ["IV", "VII"] },
  "commercial-grade-dedication": { domain: "nuclear-appendix-b", sections: ["21.3", "21.21(a)"], criteria: ["III", "VII"] },
  "appendix-b-interface-control": { domain: "nuclear-appendix-b", sections: ["21.3"], criteria: ["III", "VI"] },
  "appendix-b-nonconformance-cap": { domain: "nuclear-appendix-b", sections: ["21.21(a)"], criteria: ["XV", "XVI"] },
  "appendix-b-records-audit": { domain: "nuclear-appendix-b", sections: ["21.21(c)"], criteria: ["XVII", "XVIII"] },
};
const METHOD: Record<string, { name: string; description: string; sections: string[]; criteria: string[] }> = {
  "audit-phases": { name: "Nuclear QA audit phase guide (Appendix B I-XVIII x Part 21)", description: "Guides the five phases of a nuclear quality assurance audit, binding each phase to the applicable 10 CFR 50 Appendix B criterion and the Part 21 reporting obligation it can trigger.", sections: ["21.21(a)"], criteria: ["I", "II", "XVIII"] },
  "frame-scope": { name: "Scope framing interview (nuclear QA)", description: "Frames audit scope against safety-related functions, basic components and Appendix B criteria rather than generic document review.", sections: ["21.2", "21.3"], criteria: ["I", "II", "III"] },
  "evidence-intake": { name: "Nuclear evidence intake coach (Appendix B XVII)", description: "Collects quality records with the provenance, legibility, retention and custody attributes Appendix B XVII requires, and separates assertion from retained record.", sections: ["21.21(c)"], criteria: ["XVII"] },
  "trace-chain": { name: "Basic-component genealogy trace (Appendix B VII/VIII/XV)", description: "Traces a basic component from procurement through dedication, receipt, installation and modification, including heat-lot, serial and interface linkages.", sections: ["21.3"], criteria: ["VII", "VIII", "XV"] },
  "finding-challenge": { name: "Finding challenge dialogue (Appendix B XV/XVI)", description: "Challenges a candidate finding against the requirement, the objective evidence and the corrective-action obligation before it is treated as a nonconformance.", sections: ["21.21(a)"], criteria: ["XV", "XVI"] },
  "readiness-close": { name: "Readiness and closure facilitator (Appendix B XVIII)", description: "Tests whether an audit can close: evidence sufficiency, corrective-action effectiveness, records retention and unresolved Part 21 reportability.", sections: ["21.21(a)", "21.21(c)"], criteria: ["XVI", "XVII", "XVIII"] },
};
const bump = (v: string) => { const p = v.split("."); p[1] = String(Number(p[1] ?? 0) + 1); return p.join("."); };
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
  const [cands] = await db.query<any[]>("SELECT config_id, version, payload FROM part21_controlled_configuration WHERE kind='skill_candidate' AND status='draft'");
  let promoted = 0;
  for (const row of cands) {
    const meta = DOMAIN[row.config_id]; if (!meta) continue;
    const payload = { ...(typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload), domain: meta.domain, part21Sections: meta.sections, appendixBCriteria: meta.criteria, approvalBasis: "Application baseline pack. Qualified nuclear QA and regulatory review pending; not a regulator-approved interpretation.", scope: "10 CFR Part 21 with 10 CFR 50 Appendix B nuclear QA criteria" };
    await db.query("INSERT INTO part21_controlled_configuration (kind, config_id, version, payload, source_sha256, status) VALUES ('skill',?,?,?,?,'active') ON DUPLICATE KEY UPDATE payload=VALUES(payload), source_sha256=VALUES(source_sha256), status='active'", [row.config_id, bump(row.version), JSON.stringify(payload), sha(payload)]);
    await db.query("UPDATE part21_controlled_configuration SET status='retired' WHERE kind='skill_candidate' AND config_id=? AND version=?", [row.config_id, row.version]);
    promoted++;
  }
  const [methods] = await db.query<any[]>("SELECT config_id, version, payload FROM part21_controlled_configuration WHERE kind='skill' AND status='active' AND JSON_EXTRACT(payload,'$.domain') IS NULL");
  let rescoped = 0;
  for (const row of methods) {
    const meta = METHOD[row.config_id]; if (!meta) continue;
    const base = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const payload = { ...base, name: meta.name, description: meta.description, domain: "nuclear-qa-method", appliesWithin: "nuclear-part21-appendix-b", part21Sections: meta.sections, appendixBCriteria: meta.criteria, approvalBasis: "Application baseline method skill, re-scoped to nuclear QA. Qualified review pending." };
    await db.query("INSERT INTO part21_controlled_configuration (kind, config_id, version, payload, source_sha256, status) VALUES ('skill',?,?,?,?,'active')", [row.config_id, bump(row.version), JSON.stringify(payload), sha(payload)]);
    await db.query("UPDATE part21_controlled_configuration SET status='retired' WHERE kind='skill' AND config_id=? AND version=?", [row.config_id, row.version]);
    rescoped++;
  }
  const [audit] = await db.query<any[]>("UPDATE part21_domain_records SET payload=JSON_SET(payload,'$.standard','10 CFR Part 21 · 10 CFR 50 App B') WHERE domain='audit' AND id='AUD-026'");
  const [active] = await db.query<any[]>("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.domain')) d, COUNT(*) c FROM part21_controlled_configuration WHERE kind='skill' AND status='active' GROUP BY d");
  console.log(`promoted=${promoted} rescoped=${rescoped} auditRows=${audit.affectedRows}`);
  console.log(active.map((r: any) => `${r.d}=${r.c}`).join("  "));
  await db.end(); process.exit(0);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
