export interface McpConnector {
  id: string;
  name: string;
  category: "vendor-erp" | "document-repository";
  transport: "MCP / SSE" | "MCP / webhook";
  auth: string;
  status: "Synthetic adapter" | "Ready to connect";
  dataClasses: string[];
  tools: { name: string; description: string; readOnly: boolean }[];
}

export interface SimulationToolCall {
  sequence: number;
  tool: string;
  connector: string;
  arguments: Record<string, string | number | boolean | string[]>;
  result: string;
  provenance: string;
}

export interface HumanGateApproval {
  gate: string;
  approver: string;
  decision: "Approved" | "Approved with action";
  rationale: string;
  timestamp: string;
}

export interface SimulationStep {
  phase: number;
  phaseId: string;
  phaseLabel: string;
  agent: string;
  route: string;
  status: "Completed";
  toolCalls: SimulationToolCall[];
  humanGate: HumanGateApproval;
}

export const mcpConnectors: McpConnector[] = [
  {
    id: "vendor-erp-asterion",
    name: "Asterion Vendor ERP",
    category: "vendor-erp",
    transport: "MCP / SSE",
    auth: "OAuth 2.0 client credentials · tenant-scoped",
    status: "Ready to connect",
    dataClasses: ["Purchase orders", "Heat lots", "Receiving records", "Supplier changes"],
    tools: [
      { name: "erp_search_material_lots", description: "Find material heat, lot, batch, and certificate relationships.", readOnly: true },
      { name: "erp_get_purchase_order", description: "Retrieve PO line, supplier notification, and delivery context.", readOnly: true },
      { name: "erp_get_receiving_inspection", description: "Read receiving inspection and disposition records.", readOnly: true },
    ],
  },
  {
    id: "document-repository-live",
    name: "Controlled Document Repository",
    category: "document-repository",
    transport: "MCP / webhook",
    auth: "Signed webhook + repository service account",
    status: "Ready to connect",
    dataClasses: ["Controlled revisions", "Change packages", "Work instructions", "Approval records"],
    tools: [
      { name: "dms_search_revisions", description: "Search controlled document revisions by product, requirement, or effective date.", readOnly: true },
      { name: "dms_get_change_package", description: "Retrieve change package contents, approvals, and impacted documents.", readOnly: true },
      { name: "dms_get_effective_snapshot", description: "Resolve the document state at a historical effective date.", readOnly: true },
    ],
  },
];

export const simulatedFinding = {
  id: "FIND-2026-04",
  title: "Receiving inspection cannot resolve heat-lot chain for NSS-4820",
  auditId: "AUD-026",
  productId: "NSS-4820",
  supplierId: "SUP-044",
  status: "Open · simulated execution",
};
