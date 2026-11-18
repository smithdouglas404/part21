export type OntologyClass = "Regulation" | "Requirement" | "Facility" | "Product" | "Component" | "Supplier" | "MaterialLot" | "Evidence" | "Change" | "Finding" | "Person" | "Document" | "Audit" | "Control";

export interface OntologyProperty {
  name: string;
  type: "string" | "date" | "number" | "boolean" | "reference";
  required?: boolean;
}

export interface OntologyClassDefinition {
  id: OntologyClass;
  label: string;
  description: string;
  properties: OntologyProperty[];
}

export interface OntologyRelationDefinition {
  id: string;
  from: OntologyClass;
  to: OntologyClass;
  label: string;
  temporal: boolean;
  inverse?: string;
}

export interface TemporalRecord {
  entityId: string;
  entityClass: OntologyClass;
  validFrom: string;
  validTo?: string;
  recordedAt: string;
  recordedBy: string;
  operation: "created" | "updated" | "superseded" | "linked" | "approved";
  payload: Record<string, string | number | boolean>;
}

export const part21Ontology = {
  id: "part21-assurance-ontology",
  version: "0.1-demo",
  source: "Part 21-style traceability, nonconforming article, supplier oversight, configuration, evidence, and audit concepts",
  temporalModel: "Bitemporal event-sourced property graph: valid time + transaction time",
  classes: [
    { id: "Regulation", label: "Regulation / standard", description: "External or client-owned authority that defines assurance expectations.", properties: [{ name: "identifier", type: "string", required: true }, { name: "title", type: "string", required: true }] },
    { id: "Requirement", label: "Requirement", description: "A testable obligation such as Part 21.51 or Part 21.61.", properties: [{ name: "identifier", type: "string", required: true }, { name: "text", type: "string", required: true }, { name: "effectiveFrom", type: "date", required: true }] },
    { id: "Facility", label: "Facility / unit", description: "A nuclear site, unit, system, or controlled operating location.", properties: [{ name: "identifier", type: "string", required: true }, { name: "classification", type: "string" }] },
    { id: "Product", label: "Product / item", description: "A safety-related product, assembly, component, or serialized item.", properties: [{ name: "identifier", type: "string", required: true }, { name: "revision", type: "string" }, { name: "classification", type: "string" }] },
    { id: "Component", label: "Component / part", description: "A constituent part or material that participates in product genealogy.", properties: [{ name: "identifier", type: "string", required: true }, { name: "partNumber", type: "string" }] },
    { id: "Supplier", label: "Supplier / vendor", description: "An external provider with accountable quality and change obligations.", properties: [{ name: "identifier", type: "string", required: true }, { name: "name", type: "string", required: true }] },
    { id: "MaterialLot", label: "Material / heat lot", description: "A material identity used to close the product genealogy chain.", properties: [{ name: "identifier", type: "string", required: true }, { name: "certificateId", type: "string" }] },
    { id: "Evidence", label: "Evidence", description: "A controlled record, inspection, certificate, memo, or observation supporting a conclusion.", properties: [{ name: "identifier", type: "string", required: true }, { name: "sourceSystem", type: "string", required: true }, { name: "confidence", type: "number" }, { name: "effectiveFrom", type: "date" }] },
    { id: "Change", label: "Change / configuration event", description: "A proposed or approved change with impact and effective state.", properties: [{ name: "identifier", type: "string", required: true }, { name: "changeType", type: "string" }, { name: "effectiveFrom", type: "date", required: true }] },
    { id: "Finding", label: "Finding / condition", description: "A human-reviewable condition tied to evidence, controls, and accountable action.", properties: [{ name: "identifier", type: "string", required: true }, { name: "severity", type: "string" }, { name: "status", type: "string" }] },
    { id: "Person", label: "Person / role", description: "An accountable person, delegated role, reviewer, or approver.", properties: [{ name: "identifier", type: "string", required: true }, { name: "role", type: "string" }] },
    { id: "Document", label: "Controlled document", description: "A revisioned work instruction, design basis, change package, or procedure.", properties: [{ name: "identifier", type: "string", required: true }, { name: "revision", type: "string" }, { name: "effectiveFrom", type: "date" }] },
    { id: "Audit", label: "Audit / review", description: "A bounded assurance activity with scope, evidence, findings, and approvals.", properties: [{ name: "identifier", type: "string", required: true }, { name: "status", type: "string" }] },
    { id: "Control", label: "Control", description: "A mapped testable control family used to calculate coverage and gaps.", properties: [{ name: "identifier", type: "string", required: true }, { name: "coverage", type: "number" }] },
  ] as OntologyClassDefinition[],
  relations: [
    { id: "governs", from: "Regulation", to: "Requirement", label: "governs", temporal: true },
    { id: "tests", from: "Requirement", to: "Audit", label: "tested by", temporal: true, inverse: "testsRequirement" },
    { id: "appliesTo", from: "Requirement", to: "Product", label: "applies to", temporal: true },
    { id: "locatedAt", from: "Product", to: "Facility", label: "located at", temporal: true },
    { id: "contains", from: "Product", to: "Component", label: "contains", temporal: true },
    { id: "suppliedBy", from: "Product", to: "Supplier", label: "supplied by", temporal: true },
    { id: "madeFrom", from: "Component", to: "MaterialLot", label: "made from", temporal: true },
    { id: "evidencedBy", from: "Product", to: "Evidence", label: "evidenced by", temporal: true },
    { id: "documentedBy", from: "Change", to: "Document", label: "documented by", temporal: true },
    { id: "changes", from: "Change", to: "Product", label: "changes", temporal: true },
    { id: "impacts", from: "Change", to: "Evidence", label: "impacts", temporal: true },
    { id: "identifiedBy", from: "Audit", to: "Finding", label: "identified", temporal: true },
    { id: "about", from: "Finding", to: "Product", label: "about", temporal: true },
    { id: "supportedBy", from: "Finding", to: "Evidence", label: "supported by", temporal: true },
    { id: "raisedBy", from: "Finding", to: "Person", label: "raised by", temporal: true },
    { id: "approvedBy", from: "Change", to: "Person", label: "approved by", temporal: true },
    { id: "hasControl", from: "Audit", to: "Control", label: "tests control", temporal: true },
  ] as OntologyRelationDefinition[],
};

