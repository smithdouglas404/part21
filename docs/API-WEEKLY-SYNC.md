# Weekly sync and approval API

The Part 21 Assurance OS exposes both ordinary HTTP routes and MCP tools. These examples use JSON over HTTP and assume the application is running at `http://localhost:3000`.

## 1. Run a weekly synchronization

```http
POST /api/sync/weekly
Content-Type: application/json
```

Request:

```json
{
  "actor": "Jordan Lewis"
}
```

Equivalent MCP request:

```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "method": "tools/call",
  "params": {
    "name": "run_weekly_source_sync",
    "arguments": {
      "actor": "Jordan Lewis"
    }
  }
}
```

The result includes:

```json
{
  "runId": "SYNC-20261118090000",
  "workbookSync": {
    "root": "/absolute/path/to/excel-inbox",
    "filesChecked": 2,
    "results": [
      {
        "filename": "supplier-notifications.xlsx",
        "status": "changed_and_imported",
        "sha256": "…",
        "workbookId": "WB-20261118090000"
      },
      {
        "filename": "supplier-master.xlsx",
        "status": "unchanged",
        "sha256": "…",
        "priorWorkbookId": "WB-20261111090000"
      }
    ],
    "humanGate": "Changed workbook revisions require qualified human approval before authoritative graph promotion."
  },
  "connectedSources": [
    { "id": "excel-local-directory", "label": "Excel / local directory", "status": "connected" }
  ],
  "pendingConnectorSetup": [
    { "id": "sap-erp", "label": "SAP ERP", "status": "configure_later" },
    { "id": "salesforce-supplier", "label": "Salesforce supplier relationship", "status": "configure_later" }
  ],
  "complianceChecks": {
    "auditReadiness": {},
    "policyCoverage": {},
    "supplierRisk": {
      "status": "review_required",
      "recommendation": "Run supplier risk once the ERP/Salesforce connector is configured."
    }
  },
  "humanGates": [
    "Review changed workbook revisions",
    "Approve any graph-overlay promotion",
    "Validate Part 21 applicability with qualified SMEs",
    "Do not file or notify automatically"
  ]
}
```

A workbook with the same SHA-256 as the last imported revision is returned as `unchanged` and is not imported again.

## 2. List pending workbook approvals

```http
GET /api/approvals/pending
```

Example response:

```json
{
  "approvalStatus": "pending_human_review",
  "items": [
    {
      "workbookId": "WB-20261118090000",
      "importedAt": "2026-11-18T09:00:00.000Z",
      "actor": "Weekly Part 21 scheduler",
      "snapshot": {
        "name": "supplier-notifications.xlsx",
        "sha256": "…",
        "sheets": [
          { "name": "SupplierNotifications", "rows": 12, "columns": 9 }
        ]
      },
      "diff": {
        "status": "changed",
        "changed": []
      },
      "approvalStatus": "pending_human_review"
    }
  ],
  "humanGate": "Qualified reviewer must inspect source provenance and revision diff before approval."
}
```

## 3. Approve an imported revision

```http
POST /api/approvals/workbooks/WB-20261118090000
Content-Type: application/json
```

Request:

```json
{
  "actor": "Quality approver",
  "note": "Reviewed supplier notification revision, source hash, and changed rows against the controlled record."
}
```

Equivalent MCP request:

```json
{
  "jsonrpc": "2.0",
  "id": 102,
  "method": "tools/call",
  "params": {
    "name": "excel_approve_import",
    "arguments": {
      "workbookId": "WB-20261118090000",
      "actor": "Quality approver",
      "note": "Reviewed source hash and changed rows."
    }
  }
}
```

Successful approval returns:

```json
{
  "ok": true,
  "status": "approved_and_persisted",
  "graphProjectionCount": 12,
  "event": {
    "type": "excel.graph_import_approved",
    "entityId": "WB-20261118090000",
    "payload": {
      "validTime": "2026-11-18T09:00:00.000Z",
      "transactionTime": "2026-11-18T09:04:00.000Z",
      "graphMutation": "durable_bitemporal_overlay_persisted"
    }
  },
  "warning": "The durable workbook overlay is persisted. Client-qualified ontology mapping is still required before promoting rows into authoritative system-of-record entities."
}
```

Approval is not equivalent to a Part 21 reportability determination. It authorizes persistence of the workbook overlay after human review.

## 4. Read the event store

```http
GET /api/events/status
GET /api/events?type=excel.graph_import_approved
```

MCP resource form:

```json
{
  "jsonrpc": "2.0",
  "id": 103,
  "method": "resources/read",
  "params": {
    "uri": "part21://event-store/status"
  }
}
```

## 5. Deployment-time weekly schedule

The schedule is intentionally not claimed as active until the project is deployed. After deployment, create one recurring Monday schedule through the platform scheduling owner with:

```text
Title: Weekly Part 21 source synchronization
Cron: 0 0 9 * * 1
Repeated: true
Detail: Run run_weekly_source_sync. Import changed supplier workbooks, query connected ERP and supplier connectors, evaluate audit readiness and Part 21 policy coverage, report pending approvals and unconfigured connectors, and never file reports or promote authoritative graph entities without human approval.
```

The project currently exposes the application-native sync endpoint and MCP tool. Deployment is the prerequisite for enabling the platform-managed unattended schedule.
