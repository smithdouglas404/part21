import "dotenv/config";
import { getDomainRecordScoped, writeDomainRecord } from "../server/domain-store";
import { createPart21CaseRecord } from "../server/part21-case";
import { raiseAuditAlerts } from "../server/alerts";
import type { AssurancePrincipal } from "../server/access-control";

const ACTOR = "Frank · database detail seed";
const AUDITS = ["AUD-005","AUD-008","AUD-011","AUD-014","AUD-017","AUD-019","AUD-021","AUD-027","AUD-028"] as const;
const principal: AssurancePrincipal = {
  id: "system:audit-detail-seed",
  actor: "Frank",
  roleIds: ["admin"],
  auditIds: [...AUDITS],
  auditWriteIds: [...AUDITS],
  access: "make_changes",
  isAdmin: true,
  qualified: false,
};

type FindingSeed = { id:string; title:string; severity:string; status:string; owner:string; age:string; source:string };
type EvidenceSeed = { id:string; title:string; type:string; source:string; state:string; freshness:string; confidence:number; linkedTo:string };
type ControlSeed = { id:string; title:string; family:string; coverage:number; status:string; signal:string; next:string };
type AuditSeed = {
  auditId:string;
  product:{ id:string; label:string; meta:string; status:string; tone:string; description:string };
  supplier:{ id:string; label:string; meta:string; status:string; tone:string; description:string };
  change:{ id:string; label:string; meta:string; status:string; tone:string; description:string };
  sources:Array<{ id:string; name:string; kind:string; records:string; freshness:string; lastEvent:string; status:string }>;
  findings:FindingSeed[];
  evidence:EvidenceSeed[];
  controls:ControlSeed[];
  metric:{ readiness:number; readinessDelta:string; openFindings:number; criticalFindings:number; changes30d:number; supplierExposure:number };
  case:{ caseId:string; title:string; findingId:string; evidenceId:string; daysAgo:number };
};

const seeds: AuditSeed[] = [
  {
    auditId:"AUD-005",
    product:{ id:"PRD-0501", label:"NSS-4410", meta:"Safety injection check valve", status:"In service", tone:"green", description:"Check valve supplied under the prior-year supplier notification programme." },
    supplier:{ id:"SUP-0501", label:"Helios Forge", meta:"Supplier", status:"Watch", tone:"amber", description:"Forging supplier whose notice triggered the prior-year screening review." },
    change:{ id:"CHG-0501", label:"CHG-005-01", meta:"Supplier change", status:"Approved", tone:"green", description:"Supplier process change accepted after the screening review." },
    sources:[
      { id:"SRC-0501-QMS", name:"Quality system of record", kind:"SQL / API", records:"4,180", freshness:"12 min ago", lastEvent:"Supplier notice 2025-118 screened", status:"Healthy" },
      { id:"SRC-0501-DMS", name:"Document control", kind:"DMS / events", records:"8,420", freshness:"1 hr ago", lastEvent:"Screening checklist Rev 3 retrieved", status:"Healthy" },
    ],
    findings:[
      { id:"F-0501", title:"Supplier notice screened after the 10-day evaluation window", severity:"Major", status:"Open", owner:"Alex Rivera", age:"14d", source:"Supplier portal · notice 2025-118" },
      { id:"F-0502", title:"Notification log omitted the heat-lot reference", severity:"Minor", status:"In remediation", owner:"Tessa Morgan", age:"22d", source:"Quality record · screening log" },
      { id:"F-0503", title:"Screening checklist lacks independent second review", severity:"Observation", status:"Closed", owner:"Elena Vasquez", age:"35d", source:"Document control · checklist Rev 3" },
    ],
    evidence:[
      { id:"EV-0501", title:"Supplier notice 2025-118", type:"Supplier notification", source:"Supplier portal", state:"Current", freshness:"3 months ago", confidence:0.97, linkedTo:"F-0501 · PRD-0501" },
      { id:"EV-0502", title:"Notification screening log", type:"Screening record", source:"Quality system", state:"In review", freshness:"2 months ago", confidence:0.88, linkedTo:"F-0502 · PRD-0501" },
      { id:"EV-0503", title:"Screening checklist Rev 3", type:"Checklist", source:"Document control", state:"Superseded", freshness:"5 months ago", confidence:0.74, linkedTo:"F-0503 · PRD-0501" },
    ],
    controls:[
      { id:"C-0501", title:"Notification screening and evaluation", family:"Identification / traceability", coverage:91, status:"Healthy", signal:"Notice retained with receipt timestamp", next:"Confirm the 10-day decision record" },
      { id:"C-0502", title:"Nonconforming article control", family:"Corrective action", coverage:78, status:"Watch", signal:"Heat-lot reference missing from one log", next:"Rebind the log to the heat-lot record" },
      { id:"C-0503", title:"Supplier change oversight", family:"External providers", coverage:84, status:"Watch", signal:"Second-review step not evidenced", next:"Add independent review to the checklist" },
    ],
    metric:{ readiness:88, readinessDelta:"+2.1", openFindings:2, criticalFindings:0, changes30d:3, supplierExposure:1 },
    case:{ caseId:"P21-2026-005", title:"Prior-year supplier notice screening — heat-lot reference", findingId:"F-0501", evidenceId:"EV-0501", daysAgo:30 },
  },
  {
    auditId:"AUD-008",
    product:{ id:"PRD-0801", label:"RCP-220", meta:"Reactor coolant pump seal", status:"In service", tone:"green", description:"Field-maintained pump seal assembly in the Unit 2 reactor coolant loop." },
    supplier:{ id:"SUP-0801", label:"Northstar Field Services", meta:"Supplier", status:"Watch", tone:"amber", description:"Field inspection and maintenance service provider." },
    change:{ id:"CHG-0801", label:"CHG-008-01", meta:"Maintenance change", status:"Approved", tone:"green", description:"Torque verification step added to the preventive-maintenance work package." },
    sources:[
      { id:"SRC-0801-FIELD", name:"Field / maintenance data", kind:"Batch / files", records:"1,240", freshness:"35 min ago", lastEvent:"PM work order 08-114 closed", status:"Watch" },
      { id:"SRC-0801-QMS", name:"Quality system of record", kind:"SQL / API", records:"4,180", freshness:"18 min ago", lastEvent:"Inspection photo 08-221 registered", status:"Healthy" },
    ],
    findings:[
      { id:"F-0801", title:"Preventive-maintenance record missing final torque trace", severity:"Major", status:"Open", owner:"Liam Foster", age:"6d", source:"Field record · PM 08-114" },
      { id:"F-0802", title:"Inspection photo has no calibration identifier", severity:"Minor", status:"Open", owner:"Elena Vasquez", age:"11d", source:"Inspection record · photo 08-221" },
      { id:"F-0803", title:"Field correction lacks a recorded rationale", severity:"Minor", status:"In remediation", owner:"Tessa Morgan", age:"18d", source:"Field log · correction 08-019" },
    ],
    evidence:[
      { id:"EV-0801", title:"Preventive-maintenance work order 08-114", type:"Field record", source:"Field / maintenance data", state:"Current", freshness:"6 days ago", confidence:0.93, linkedTo:"F-0801 · PRD-0801" },
      { id:"EV-0802", title:"Inspection photo 08-221", type:"Inspection photo", source:"Quality system", state:"In review", freshness:"11 days ago", confidence:0.81, linkedTo:"F-0802 · PRD-0801" },
      { id:"EV-0803", title:"Field correction log 08-019", type:"Field log", source:"Field / maintenance data", state:"Current", freshness:"18 days ago", confidence:0.87, linkedTo:"F-0803 · PRD-0801" },
    ],
    controls:[
      { id:"C-0801", title:"Maintenance record completeness", family:"Identification / traceability", coverage:64, status:"Gap", signal:"Final torque value absent", next:"Recover the torque trace from the technician record" },
      { id:"C-0802", title:"Inspection equipment traceability", family:"Control of measuring equipment", coverage:71, status:"Watch", signal:"Calibration ID missing from photo", next:"Link the photo to the calibration record" },
      { id:"C-0803", title:"Field correction control", family:"Corrective action", coverage:58, status:"Gap", signal:"Correction rationale not recorded", next:"Require a reason code before correction" },
    ],
    metric:{ readiness:34, readinessDelta:"-1.2", openFindings:3, criticalFindings:0, changes30d:6, supplierExposure:1 },
    case:{ caseId:"P21-2026-008", title:"Field maintenance torque trace — work order 08-114", findingId:"F-0801", evidenceId:"EV-0801", daysAgo:1 },
  },
  {
    auditId:"AUD-011",
    product:{ id:"PRD-1101", label:"DOC-21-11", meta:"Controlled procedure set", status:"In service", tone:"green", description:"Controlled procedures and supplier-notice work instructions." },
    supplier:{ id:"SUP-1101", label:"Document Control", meta:"Internal provider", status:"Healthy", tone:"green", description:"Controlled-document repository and retention owner." },
    change:{ id:"CHG-1101", label:"CHG-011-01", meta:"Document change", status:"Approved", tone:"green", description:"Procedure revision retired from the active work package." },
    sources:[
      { id:"SRC-1101-DMS", name:"Document control", kind:"DMS / events", records:"8,420", freshness:"9 min ago", lastEvent:"Procedure WI-118 revision retired", status:"Watch" },
      { id:"SRC-1101-QMS", name:"Quality system of record", kind:"SQL / API", records:"4,180", freshness:"26 min ago", lastEvent:"Retention schedule reviewed", status:"Healthy" },
    ],
    findings:[
      { id:"F-1101", title:"Superseded procedure remained in the active work package", severity:"Major", status:"Open", owner:"Renee Calloway", age:"8d", source:"Document control · WI-118" },
      { id:"F-1102", title:"Retention schedule not applied to supplier notices", severity:"Minor", status:"Open", owner:"Tessa Morgan", age:"16d", source:"Records inventory · supplier notices" },
      { id:"F-1103", title:"Document index has no Part 21 applicability tag", severity:"Observation", status:"In remediation", owner:"Elena Vasquez", age:"21d", source:"Document index · controlled procedures" },
    ],
    evidence:[
      { id:"EV-1101", title:"Procedure WI-118 Rev 6", type:"Controlled procedure", source:"Document control", state:"Superseded", freshness:"2 months ago", confidence:0.95, linkedTo:"F-1101 · PRD-1101" },
      { id:"EV-1102", title:"Supplier notice retention schedule", type:"Retention schedule", source:"Quality system", state:"In review", freshness:"4 months ago", confidence:0.84, linkedTo:"F-1102 · PRD-1101" },
      { id:"EV-1103", title:"Document index export", type:"Index export", source:"Document control", state:"Current", freshness:"8 days ago", confidence:0.79, linkedTo:"F-1103 · PRD-1101" },
    ],
    controls:[
      { id:"C-1101", title:"Controlled document currency", family:"Document control", coverage:82, status:"Watch", signal:"Superseded procedure still in work package", next:"Remove WI-118 Rev 6 from the active package" },
      { id:"C-1102", title:"Records retention", family:"Records management", coverage:74, status:"Watch", signal:"Supplier notices missing retention code", next:"Apply the notice retention schedule" },
      { id:"C-1103", title:"Part 21 applicability tagging", family:"Identification / traceability", coverage:69, status:"Gap", signal:"Index lacks applicability field", next:"Add a controlled applicability tag" },
    ],
    metric:{ readiness:58, readinessDelta:"+4.0", openFindings:3, criticalFindings:0, changes30d:4, supplierExposure:0 },
    case:{ caseId:"P21-2026-011", title:"Superseded procedure in active work package — WI-118", findingId:"F-1101", evidenceId:"EV-1101", daysAgo:20 },
  },
  {
    auditId:"AUD-014",
    product:{ id:"PRD-1401", label:"SIS-MNT-02", meta:"Seismic mounting interface", status:"In service", tone:"green", description:"Seismic mounting interface for the Unit 2 safety injection skid." },
    supplier:{ id:"SUP-1401", label:"Helios Forge", meta:"Supplier", status:"Watch", tone:"amber", description:"Fabricator of the seismic mounting hardware." },
    change:{ id:"CHG-1401", label:"CHG-014-07", meta:"Engineering change", status:"Review", tone:"red", description:"Anchor-layout revision that has not completed configuration approval." },
    sources:[
      { id:"SRC-1401-ECM", name:"Engineering change system", kind:"API / webhook", records:"612", freshness:"7 min ago", lastEvent:"CHG-014-07 impact set updated", status:"Watch" },
      { id:"SRC-1401-CAD", name:"Configuration baseline", kind:"SQL / API", records:"2,904", freshness:"22 min ago", lastEvent:"As-built drawing AS-214 retrieved", status:"Watch" },
    ],
    findings:[
      { id:"F-1401", title:"Seismic mounting change not reconciled to the as-built drawing", severity:"Critical", status:"Open", owner:"Hana Ito", age:"4d", source:"Configuration baseline · AS-214" },
      { id:"F-1402", title:"Interface drawing revision missing from the change package", severity:"Major", status:"In remediation", owner:"Evan Brooks", age:"12d", source:"Engineering change · CHG-014-07" },
      { id:"F-1403", title:"Configuration index omits the supplier deviation", severity:"Minor", status:"Open", owner:"Tessa Morgan", age:"19d", source:"Configuration index · deviation 14-02" },
    ],
    evidence:[
      { id:"EV-1401", title:"As-built drawing AS-214", type:"As-built drawing", source:"Configuration baseline", state:"Current", freshness:"4 days ago", confidence:0.98, linkedTo:"F-1401 · PRD-1401" },
      { id:"EV-1402", title:"Change package CHG-014-07", type:"Change package", source:"Engineering change system", state:"In review", freshness:"12 days ago", confidence:0.9, linkedTo:"F-1402 · PRD-1401" },
      { id:"EV-1403", title:"Supplier deviation 14-02", type:"Deviation record", source:"Supplier portal", state:"Current", freshness:"19 days ago", confidence:0.83, linkedTo:"F-1403 · PRD-1401" },
    ],
    controls:[
      { id:"C-1401", title:"Design and configuration control", family:"Configuration baseline", coverage:61, status:"Gap", signal:"As-built anchor layout differs from design", next:"Reconcile the anchor layout and reapprove the baseline" },
      { id:"C-1402", title:"Interface control", family:"Design interface", coverage:55, status:"Gap", signal:"Interface drawing revision absent", next:"Add the missing drawing revision to the package" },
      { id:"C-1403", title:"Supplier deviation control", family:"External providers", coverage:72, status:"Watch", signal:"Deviation not in the configuration index", next:"Index the deviation against the affected item" },
    ],
    metric:{ readiness:61, readinessDelta:"-2.4", openFindings:3, criticalFindings:1, changes30d:8, supplierExposure:1 },
    case:{ caseId:"P21-2026-014", title:"Seismic mounting as-built conflict — drawing AS-214", findingId:"F-1401", evidenceId:"EV-1401", daysAgo:5 },
  },
  {
    auditId:"AUD-017",
    product:{ id:"PRD-1701", label:"QA-PROG-02", meta:"Part 21 QA program", status:"Active", tone:"green", description:"Northstar Unit 2 quality-assurance programme and applicability controls." },
    supplier:{ id:"SUP-1701", label:"Northstar QA", meta:"Internal provider", status:"Healthy", tone:"green", description:"Quality assurance function responsible for applicability screening." },
    change:{ id:"CHG-1701", label:"CHG-017-01", meta:"Program change", status:"Approved", tone:"green", description:"Applicability screening procedure updated for the current 21.2 interpretation." },
    sources:[
      { id:"SRC-1701-QMS", name:"Quality system of record", kind:"SQL / API", records:"4,180", freshness:"11 min ago", lastEvent:"Applicability screening 17-042 reviewed", status:"Healthy" },
      { id:"SRC-1701-TRN", name:"Training records", kind:"Directory", records:"641", freshness:"2 hr ago", lastEvent:"Contract QA reviewer roster updated", status:"Watch" },
    ],
    findings:[
      { id:"F-1701", title:"Applicability screening relied on a superseded 21.2 interpretation", severity:"Major", status:"In remediation", owner:"Tessa Morgan", age:"7d", source:"Applicability record 17-042" },
      { id:"F-1702", title:"Training roster omits contract QA reviewers", severity:"Minor", status:"Open", owner:"Elena Vasquez", age:"15d", source:"Training roster · contract QA" },
      { id:"F-1703", title:"No periodic trigger to reassess applicability", severity:"Observation", status:"Open", owner:"Alex Rivera", age:"28d", source:"QA procedure · applicability" },
    ],
    evidence:[
      { id:"EV-1701", title:"Applicability screening 17-042", type:"Screening record", source:"Quality system", state:"Current", freshness:"7 days ago", confidence:0.96, linkedTo:"F-1701 · PRD-1701" },
      { id:"EV-1702", title:"Contract QA training roster", type:"Training record", source:"Training records", state:"In review", freshness:"15 days ago", confidence:0.86, linkedTo:"F-1702 · PRD-1701" },
      { id:"EV-1703", title:"Applicability procedure QA-17", type:"Controlled procedure", source:"Document control", state:"Current", freshness:"28 days ago", confidence:0.91, linkedTo:"F-1703 · PRD-1701" },
    ],
    controls:[
      { id:"C-1701", title:"Part 21 applicability screening", family:"Applicability", coverage:88, status:"Watch", signal:"One screening used the prior interpretation", next:"Re-screen 17-042 against the current interpretation" },
      { id:"C-1702", title:"QA training and qualification", family:"Personnel qualification", coverage:79, status:"Watch", signal:"Contract reviewers missing from roster", next:"Add contract reviewers to the training roster" },
      { id:"C-1703", title:"Periodic applicability review", family:"Program governance", coverage:84, status:"Healthy", signal:"Annual review completed", next:"Record the next scheduled reassessment" },
    ],
    metric:{ readiness:90, readinessDelta:"+3.2", openFindings:3, criticalFindings:0, changes30d:2, supplierExposure:0 },
    case:{ caseId:"P21-2026-017", title:"Applicability screening interpretation — record 17-042", findingId:"F-1701", evidenceId:"EV-1701", daysAgo:45 },
  },
  {
    auditId:"AUD-019",
    product:{ id:"PRD-1901", label:"CAPA-2025-03", meta:"Corrective action package", status:"Open", tone:"amber", description:"Corrective action package for the 2025 receiving-inspection finding." },
    supplier:{ id:"SUP-1901", label:"Asterion", meta:"Supplier", status:"Watch", tone:"amber", description:"Supplier associated with the original receiving-inspection finding." },
    change:{ id:"CHG-1901", label:"CHG-019-01", meta:"Corrective action change", status:"Review", tone:"red", description:"Revised acceptance sampling plan awaiting approval." },
    sources:[
      { id:"SRC-1901-CAPA", name:"Corrective action system", kind:"SQL / API", records:"318", freshness:"14 min ago", lastEvent:"CAPA 2025-03 effectiveness review opened", status:"Watch" },
      { id:"SRC-1901-QMS", name:"Quality system of record", kind:"SQL / API", records:"4,180", freshness:"28 min ago", lastEvent:"Effectiveness evidence requested", status:"Healthy" },
    ],
    findings:[
      { id:"F-1901", title:"Corrective action for the 2025 receiving finding lacks effectiveness evidence", severity:"Major", status:"Open", owner:"Alex Rivera", age:"9d", source:"CAPA 2025-03" },
      { id:"F-1902", title:"Root-cause statement stops at human error", severity:"Minor", status:"Open", owner:"Tessa Morgan", age:"17d", source:"CAPA 2025-03 · root cause" },
      { id:"F-1903", title:"CAPA due date extended without an approval record", severity:"Minor", status:"In remediation", owner:"Elena Vasquez", age:"23d", source:"CAPA 2025-03 · schedule" },
    ],
    evidence:[
      { id:"EV-1901", title:"CAPA 2025-03 effectiveness plan", type:"Corrective action plan", source:"Corrective action system", state:"Current", freshness:"9 days ago", confidence:0.92, linkedTo:"F-1901 · PRD-1901" },
      { id:"EV-1902", title:"Root-cause analysis 2025-03", type:"Root-cause record", source:"Quality system", state:"In review", freshness:"17 days ago", confidence:0.78, linkedTo:"F-1902 · PRD-1901" },
      { id:"EV-1903", title:"CAPA schedule extension request", type:"Schedule record", source:"Corrective action system", state:"Current", freshness:"23 days ago", confidence:0.85, linkedTo:"F-1903 · PRD-1901" },
    ],
    controls:[
      { id:"C-1901", title:"Corrective action effectiveness", family:"Corrective action", coverage:52, status:"Gap", signal:"No objective effectiveness evidence", next:"Define a measurable effectiveness check" },
      { id:"C-1902", title:"Root-cause analysis quality", family:"Corrective action", coverage:63, status:"Watch", signal:"Root cause stops at human error", next:"Extend the analysis to the governing process" },
      { id:"C-1903", title:"CAPA schedule control", family:"Corrective action", coverage:68, status:"Watch", signal:"Extension lacks approval record", next:"Record the approval or restore the original date" },
    ],
    metric:{ readiness:41, readinessDelta:"+0.8", openFindings:3, criticalFindings:0, changes30d:5, supplierExposure:1 },
    case:{ caseId:"P21-2026-019", title:"Corrective action effectiveness — CAPA 2025-03", findingId:"F-1901", evidenceId:"EV-1901", daysAgo:2 },
  },
  {
    auditId:"AUD-021",
    product:{ id:"PRD-2101", label:"PBF-441", meta:"Pressure-boundary forging", status:"In service", tone:"green", description:"Pressure-boundary forging supplied by Asterion for the Unit 2 system." },
    supplier:{ id:"SUP-2101", label:"Asterion", meta:"Supplier", status:"Gap", tone:"red", description:"Pressure-boundary forging supplier under focused oversight." },
    change:{ id:"CHG-2101", label:"CHG-021-03", meta:"Supplier change", status:"Review", tone:"red", description:"Heat-treatment process change that has not completed QA review." },
    sources:[
      { id:"SRC-2101-SUP", name:"Asterion supplier portal", kind:"API / webhook", records:"3,906", freshness:"16 min ago", lastEvent:"Heat-treatment lot notice received", status:"Watch" },
      { id:"SRC-2101-QMS", name:"Quality system of record", kind:"SQL / API", records:"4,180", freshness:"31 min ago", lastEvent:"Supplier audit checklist reviewed", status:"Watch" },
    ],
    findings:[
      { id:"F-2101", title:"Asterion forging certificate omits the heat-treatment lot", severity:"Major", status:"Open", owner:"Marcus Bell", age:"5d", source:"Supplier portal · certificate 21-441" },
      { id:"F-2102", title:"Supplier change notice routed outside QA review", severity:"Major", status:"In remediation", owner:"Tessa Morgan", age:"13d", source:"Supplier portal · notice 21-018" },
      { id:"F-2103", title:"Supplier audit checklist omits Appendix B IV", severity:"Minor", status:"Open", owner:"Elena Vasquez", age:"20d", source:"Supplier audit · checklist Rev 2" },
    ],
    evidence:[
      { id:"EV-2101", title:"Asterion certificate 21-441", type:"Material certificate", source:"Supplier portal", state:"Current", freshness:"5 days ago", confidence:0.94, linkedTo:"F-2101 · PRD-2101" },
      { id:"EV-2102", title:"Supplier change notice 21-018", type:"Supplier notice", source:"Supplier portal", state:"In review", freshness:"13 days ago", confidence:0.89, linkedTo:"F-2102 · PRD-2101" },
      { id:"EV-2103", title:"Supplier audit checklist Rev 2", type:"Audit checklist", source:"Quality system", state:"Current", freshness:"20 days ago", confidence:0.82, linkedTo:"F-2103 · PRD-2101" },
    ],
    controls:[
      { id:"C-2101", title:"Supplier material certification", family:"External providers", coverage:57, status:"Gap", signal:"Heat-treatment lot missing", next:"Obtain the lot-specific certificate" },
      { id:"C-2102", title:"Supplier change notification", family:"External providers", coverage:66, status:"Watch", signal:"Notice routed outside QA", next:"Restore the QA routing step" },
      { id:"C-2103", title:"Supplier audit coverage", family:"External providers", coverage:73, status:"Watch", signal:"Appendix B IV not in checklist", next:"Add the procurement-item control criteria" },
    ],
    metric:{ readiness:63, readinessDelta:"-0.6", openFindings:3, criticalFindings:0, changes30d:7, supplierExposure:1 },
    case:{ caseId:"P21-2026-021", title:"Asterion heat-treatment lot certification — PBF-441", findingId:"F-2101", evidenceId:"EV-2101", daysAgo:12 },
  },
  {
    auditId:"AUD-027",
    product:{ id:"PRD-2701", label:"HFV-221", meta:"Helios forged valve body", status:"Incoming", tone:"amber", description:"Forged valve body received from Helios Forge for the Unit 2 safety injection family." },
    supplier:{ id:"SUP-2701", label:"Helios Forge", meta:"Supplier", status:"Watch", tone:"amber", description:"Forging supplier undergoing qualification for valve-body production." },
    change:{ id:"CHG-2701", label:"CHG-027-01", meta:"Supplier qualification change", status:"Review", tone:"red", description:"Heat-lot traceability method proposed during supplier qualification." },
    sources:[
      { id:"SRC-2701-RCV", name:"Receiving inspection", kind:"SQL / API", records:"842", freshness:"6 min ago", lastEvent:"Receiving report 2-481 registered", status:"Watch" },
      { id:"SRC-2701-SUP", name:"Helios supplier portal", kind:"API / webhook", records:"1,104", freshness:"42 min ago", lastEvent:"Heat 7B-441 certificate received", status:"Watch" },
    ],
    findings:[
      { id:"F-2701", title:"Heat-lot chain for the Helios valve body cannot be resolved", severity:"Major", status:"Open", owner:"Marcus Bell", age:"3d", source:"Receiving report 2-481" },
      { id:"F-2702", title:"Receiving inspection acceptance stamp is illegible", severity:"Minor", status:"Open", owner:"Liam Foster", age:"6d", source:"Receiving report 2-481" },
      { id:"F-2703", title:"Supplier scorecard excludes Part 21 notification latency", severity:"Observation", status:"Open", owner:"Tessa Morgan", age:"12d", source:"Supplier scorecard · Helios" },
    ],
    evidence:[
      { id:"EV-2701", title:"Receiving inspection report 2-481", type:"Receiving record", source:"Receiving inspection", state:"Current", freshness:"3 days ago", confidence:0.95, linkedTo:"F-2701 · PRD-2701" },
      { id:"EV-2702", title:"Heat 7B-441 material certificate", type:"Material certificate", source:"Helios supplier portal", state:"In review", freshness:"6 days ago", confidence:0.87, linkedTo:"F-2702 · PRD-2701" },
      { id:"EV-2703", title:"Helios supplier scorecard Q3", type:"Scorecard", source:"Supplier portal", state:"Current", freshness:"12 days ago", confidence:0.8, linkedTo:"F-2703 · PRD-2701" },
    ],
    controls:[
      { id:"C-2701", title:"Heat-lot traceability", family:"Identification / traceability", coverage:48, status:"Gap", signal:"Receiving record cannot resolve heat 7B-441", next:"Obtain the mill heat-lot record from Helios" },
      { id:"C-2702", title:"Receiving inspection acceptance", family:"Receiving inspection", coverage:62, status:"Watch", signal:"Acceptance stamp illegible", next:"Reinspect and re-stamp the record" },
      { id:"C-2703", title:"Supplier performance monitoring", family:"External providers", coverage:70, status:"Watch", signal:"Notification latency absent from scorecard", next:"Add Part 21 notification latency" },
    ],
    metric:{ readiness:18, readinessDelta:"+0.0", openFindings:3, criticalFindings:0, changes30d:2, supplierExposure:1 },
    case:{ caseId:"P21-2026-027", title:"Helios heat-lot traceability — receiving report 2-481", findingId:"F-2701", evidenceId:"EV-2701", daysAgo:1 },
  },
  {
    auditId:"AUD-028",
    product:{ id:"PRD-2801", label:"SIS-SEIS-02", meta:"Seismic mounting assembly", status:"Design review", tone:"amber", description:"Seismic mounting assembly for the Unit 2 safety injection skid." },
    supplier:{ id:"SUP-2801", label:"Northstar Engineering", meta:"Supplier", status:"Watch", tone:"amber", description:"Design and as-built drawing provider for the seismic mounting interface." },
    change:{ id:"CHG-2801", label:"CHG-028-02", meta:"Design change", status:"Review", tone:"red", description:"Anchor-layout design change awaiting interface reconciliation." },
    sources:[
      { id:"SRC-2801-CAD", name:"Configuration baseline", kind:"SQL / API", records:"2,904", freshness:"5 min ago", lastEvent:"As-built drawing AS-301 retrieved", status:"Watch" },
      { id:"SRC-2801-ECM", name:"Engineering change system", kind:"API / webhook", records:"612", freshness:"19 min ago", lastEvent:"CHG-028-02 interface package updated", status:"Watch" },
    ],
    findings:[
      { id:"F-2801", title:"Seismic mounting interface drawing conflicts with the as-built anchor layout", severity:"Critical", status:"Open", owner:"Hana Ito", age:"2d", source:"Configuration baseline · AS-301" },
      { id:"F-2802", title:"Design change package omits the interface control drawing", severity:"Major", status:"Open", owner:"Evan Brooks", age:"8d", source:"Engineering change · CHG-028-02" },
      { id:"F-2803", title:"As-built markup was not reverified after the revision", severity:"Minor", status:"In remediation", owner:"Tessa Morgan", age:"14d", source:"As-built record · AS-301" },
    ],
    evidence:[
      { id:"EV-2801", title:"As-built drawing AS-301", type:"As-built drawing", source:"Configuration baseline", state:"Current", freshness:"2 days ago", confidence:0.97, linkedTo:"F-2801 · PRD-2801" },
      { id:"EV-2802", title:"Interface control drawing ICD-28", type:"Interface drawing", source:"Configuration baseline", state:"In review", freshness:"8 days ago", confidence:0.88, linkedTo:"F-2802 · PRD-2801" },
      { id:"EV-2803", title:"As-built markup AS-301 Rev 2", type:"Markup record", source:"Configuration baseline", state:"Current", freshness:"14 days ago", confidence:0.84, linkedTo:"F-2803 · PRD-2801" },
    ],
    controls:[
      { id:"C-2801", title:"Design interface control", family:"Design interface", coverage:44, status:"Gap", signal:"Anchor layout conflict unresolved", next:"Reconcile ICD-28 to AS-301" },
      { id:"C-2802", title:"Configuration baseline integrity", family:"Configuration baseline", coverage:51, status:"Gap", signal:"Interface drawing missing from change package", next:"Add ICD-28 to the package" },
      { id:"C-2803", title:"As-built verification", family:"Verification", coverage:60, status:"Watch", signal:"Markup not reverified after revision", next:"Reverify and sign the as-built markup" },
    ],
    metric:{ readiness:12, readinessDelta:"-3.0", openFindings:3, criticalFindings:1, changes30d:3, supplierExposure:1 },
    case:{ caseId:"P21-2026-028", title:"Seismic interface conflict — drawing AS-301", findingId:"F-2801", evidenceId:"EV-2801", daysAgo:3 },
  },
];

async function put(recordType: string, recordId: string, auditId: string, payload: Record<string, unknown>) {
  const existing = await getDomainRecordScoped(recordType, recordId, auditId).catch(() => null);
  if (existing) return false;
  await writeDomainRecord(
    { recordType, recordId, auditId, payload },
    { expectedRevision: 0, actor: ACTOR, createOnly: true }
  );
  return true;
}

function governanceSeeds(seed: AuditSeed) {
  const suffix = seed.auditId.replace("AUD-", "");
  const primary = seed.findings[0];
  const secondary = seed.findings[1] ?? seed.findings[0];
  const at = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86400000).toISOString();
  const future = (daysAhead: number) =>
    new Date(Date.now() + daysAhead * 86400000).toISOString();
  return [
    {
      id: `GOV-${suffix}-01`,
      auditId: seed.auditId,
      title: `Confirm Part 21 applicability for ${seed.product.label}`,
      summary: `Confirm the scope anchor, governing license or approval, and qualified reviewer for ${seed.auditId} before any reportability conclusion is recorded.`,
      state: "in_review",
      priority: "critical",
      findingId: primary.id,
      skillId: "part21-applicability",
      agentId: "nuclear-applicability-screen",
      requiredFields: ["scope anchor", "applicability basis", "qualified approver"],
      completedFields: ["scope anchor"],
      owner: "M. Lee",
      lastUpdated: at(2),
      history: [
        {
          at: at(2),
          actor: "nuclear-applicability-screen",
          action: "routed",
          note: `Scope record for ${seed.product.label} requires a qualified human decision.`,
          state: "in_review",
        },
      ],
    },
    {
      id: `GOV-${suffix}-02`,
      auditId: seed.auditId,
      title: `Accept evidence sufficiency for ${primary.id}`,
      summary: `Review the source record, effective date and linkage for ${primary.title.toLowerCase()}. Registration alone is not acceptance.`,
      state: "ready",
      priority: "high",
      findingId: primary.id,
      skillId: "evidence-intake",
      agentId: "nuclear-evidence-curator",
      requiredFields: ["source record", "effective date", "owner", "evidence note"],
      completedFields: ["source record", "owner"],
      owner: primary.owner,
      lastUpdated: at(1),
      history: [],
    },
    {
      id: `GOV-${suffix}-03`,
      auditId: seed.auditId,
      title: `Challenge severity and corrective action for ${secondary.id}`,
      summary: `Test the recorded severity, causal basis and proposed corrective action for ${secondary.title.toLowerCase()} before the finding is treated as dispositioned.`,
      state: "backlog",
      priority: "high",
      findingId: secondary.id,
      skillId: "finding-challenge",
      agentId: "nuclear-finding-challenger",
      requiredFields: ["finding basis", "severity rationale", "corrective action"],
      completedFields: [],
      owner: secondary.owner,
      lastUpdated: at(3),
      history: [],
    },
    {
      id: `GOV-${suffix}-04`,
      auditId: seed.auditId,
      title: "Route the final readiness report to a qualified approver",
      summary: `Prepare the ${seed.auditId} report position and route it to a named, currently qualified approver. The route does not itself approve the report.`,
      state: "deferred",
      priority: "medium",
      skillId: "readiness-close",
      agentId: "nuclear-readiness-facilitator",
      requiredFields: ["readiness position", "action list", "approver"],
      completedFields: ["readiness position", "action list", "approver"],
      deferUntil: future(3),
      deferredAt: at(1),
      deferredDurationHours: 96,
      owner: "D. Novak",
      lastUpdated: at(1),
      history: [
        {
          at: at(1),
          actor: "D. Novak",
          action: "defer",
          note: "Awaiting the evidence-sufficiency decision before routing the final report.",
          state: "deferred",
        },
      ],
    },
    {
      id: `GOV-${suffix}-05`,
      auditId: seed.auditId,
      title: "Verify the responsible-officer contact and notice path",
      summary: `Confirm the current escalation contact and electronic Part 21 notice location used by ${seed.auditId}.`,
      state: "complete",
      priority: "medium",
      skillId: "frame-scope",
      agentId: "nuclear-scope-facilitator",
      requiredFields: ["contact test", "approval note"],
      completedFields: ["contact test", "approval note"],
      decision: "accept",
      decisionNote: "Contact path verified against the persisted people directory.",
      owner: "M. Lee",
      lastUpdated: at(6),
      history: [
        {
          at: at(6),
          actor: "M. Lee",
          action: "accept",
          note: "Contact path verified against the persisted people directory.",
          state: "complete",
        },
      ],
    },
  ];
}

async function main() {
  const summary: Record<string, any> = {};
  for (const seed of seeds) {
    const auditId = seed.auditId;
    let created = 0;
    for (const finding of seed.findings) {
      if (await put("finding", finding.id, auditId, { ...finding })) created++;
    }
    for (const evidence of seed.evidence) {
      if (await put("evidence", evidence.id, auditId, { ...evidence })) created++;
    }
    for (const control of seed.controls) {
      if (await put("control", control.id, auditId, { ...control })) created++;
    }
    if (await put("product", seed.product.id, auditId, { ...seed.product, type: "product" })) created++;
    if (await put("supplier", seed.supplier.id, auditId, { ...seed.supplier, type: "supplier" })) created++;
    if (await put("change", seed.change.id, auditId, { ...seed.change, type: "change" })) created++;
    for (const source of seed.sources) {
      if (await put("source", source.id, auditId, {
        name: source.name,
        kind: source.kind,
        records: source.records,
        freshness: source.freshness,
        lastEvent: source.lastEvent,
        status: source.status,
      })) created++;
    }
    if (await put("metric", auditId, auditId, { ...seed.metric })) created++;
    for (const governance of governanceSeeds(seed)) {
      if (await put("governance", governance.id, auditId, { ...governance })) created++;
    }

    const alerts = await raiseAuditAlerts(auditId, null).catch(error => ({ error: String(error) }));
    let caseResult: any;
    const existingCase = await getDomainRecordScoped("part21_case", seed.case.caseId, auditId).catch(() => null);
    if (!existingCase) {
      try {
        caseResult = await createPart21CaseRecord({
          auditId,
          caseId: seed.case.caseId,
          title: seed.case.title,
          findingId: seed.case.findingId,
          productId: seed.product.id,
          documentedAt: new Date(Date.now() - seed.case.daysAgo * 86400000).toISOString(),
          basis: `Discovery recorded from ${seed.case.findingId} and ${seed.case.evidenceId}; the case is opened to supervise the Part 21 evaluation clocks.`,
          reviewerPersonId: "P-002",
          evidence: [{ id: seed.case.evidenceId, kind: "evidence", note: seed.evidence[0].title }],
        }, principal);
      } catch (error) {
        caseResult = { error: String(error) };
      }
    } else {
      caseResult = { existing: true };
    }
    summary[auditId] = {
      created,
      findings: seed.findings.length,
      evidence: seed.evidence.length,
      controls: seed.controls.length,
      alerts: "error" in (alerts as any) ? (alerts as any).error : `${(alerts as any).derived} derived / ${(alerts as any).inserted} inserted`,
      case: caseResult,
    };
    console.log(auditId, JSON.stringify(summary[auditId]));
  }
  console.log("SEED SUMMARY", JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
