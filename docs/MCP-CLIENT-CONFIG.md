# Connecting Claude or another MCP client

The Part 21 Assurance OS now exposes two MCP transports:

- **Streamable HTTP:** `POST /mcp` on the running application. It supports `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read` using JSON-RPC 2.0.
- **Local stdio:** `pnpm mcp:stdio`. This is the recommended path when the workbook lives on the same machine as Claude because the process can read a local `EXCEL_ROOT` directory without uploading the workbook to a remote web server.

## Claude Desktop-style local configuration

Run the application checkout on the same machine where the Excel directory exists. Set `EXCEL_ROOT` to the directory that contains the workbook.

```json
{
  "mcpServers": {
    "part21-assurance-os": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/part21ops", "mcp:stdio"],
      "env": {
        "EXCEL_ROOT": "/absolute/path/to/my/excel-directory",
        "PART21_DATA_DIR": "/absolute/path/to/part21ops/data"
      }
    }
  }
}
```

For a globally installed checkout, use the direct bridge instead:

```json
{
  "mcpServers": {
    "part21-assurance-os": {
      "command": "node",
      "args": ["/absolute/path/to/part21ops/dist/mcp-stdio.js"],
      "env": {
        "EXCEL_ROOT": "/absolute/path/to/my/excel-directory"
      }
    }
  }
}
```

Build the application before using the `dist` form:

```bash
pnpm install
pnpm build
pnpm build:mcp
```

## Remote HTTP configuration

When the app is running on a reachable HTTPS host, configure the MCP client with:

```text
https://your-host.example/mcp
```

The endpoint is stateless JSON Streamable HTTP for the current demonstration. In a production deployment, put it behind authentication, tenant isolation, rate limiting, and an allowlist for tool scopes.

## Excel workflow to demonstrate

1. Put a workbook such as `supplier-notifications.xlsx` in `EXCEL_ROOT`.
2. Ask Claude to call `excel_list_workbooks`.
3. Call `excel_import_local_workbook` with the filename.
4. Inspect the SHA-256, sheets, sample rows, and `human_review_required` proposal.
5. Call `excel_compare_revision` after editing and saving the same workbook.
6. Call `excel_approve_import` only after a qualified person reviews the diff.
7. The current demo records approval as a durable event but does not silently mutate the assurance graph.

## Available tool groups

The MCP server exposes tools for:

- Part 21 regulatory traversal and remediation recommendations.
- Policy-as-code evaluation, coverage, policy graph traversal, and document compilation.
- Product genealogy and temporal version comparison.
- Audit readiness, control-gap detection, supplier risk, findings, evidence, and next moves.
- Excel directory discovery, workbook description, range reading, upload/import, revision comparison, and human approval.

The manifest also shows configured-later connector slots for SAP ERP, Salesforce supplier relationships, document control repositories, and configuration-management systems. These are intentionally visible but not falsely marked as connected.

## Weekly synchronization

The application exposes `run_weekly_source_sync` through MCP and `POST /api/sync/weekly` for an application scheduler. The operation is idempotent for unchanged local workbooks and returns readiness, policy coverage, supplier-risk status, changed files, and pending enterprise connectors.

The platform ScheduleTask was not created in this sandbox because the project is not deployed; the platform returned `project not deployed yet`. After deployment, create one weekly Monday schedule that invokes this operation. Until then, use the Administration panel's **Run weekly sync now** control or invoke `run_weekly_source_sync` from the MCP client.

## Safety boundary

Workbook reads and revision proposals are available to the MCP client. Graph mutation, report filing, notification, and final Part 21 interpretation remain human-gated. The system labels synthetic data, provider state, and connector status in responses so Claude cannot mistake the demonstration environment for a qualified client system.
