# Real Meta Muse Integration

This document distinguishes the real Meta Muse connection from the application’s own field Kanban UI.

## What is actually integrated

The Part 21 Assurance OS exposes a real Model Context Protocol server. The server supports the standard MCP JSON-RPC operations:

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`

It exposes the Part 21 tools and the field-engagement tools:

- `field_kanban_list`
- `field_kanban_create`
- `field_kanban_move`
- `field_kanban_attach`

The field Kanban interface in the application is not Muse. It is the operator-facing view of the same database-backed operations that Muse can call.

## Meta Muse consumer app

Meta’s official Muse connector documentation says that a service not already in the Connector list can be connected by asking Muse to create a Custom Connector. The user must provide the reachable MCP or service endpoint and complete any authorization flow in Muse.

Use the deployed HTTPS MCP endpoint, not the local `127.0.0.1` address:

```text
https://YOUR_DEPLOYED_HOST/mcp
```

In Muse, use a request such as:

```text
Create a custom connector for my Part 21 Assurance OS at:
https://YOUR_DEPLOYED_HOST/mcp
```

Then review the tools Muse discovers. For a field demonstration, ask Muse:

```text
Use the Part 21 Assurance OS connector. Create a high-priority backlog item for audit AUD-026 titled “Receiving record needs supervisor review”. Mark it as a field observation and tell me the created item ID.
```

Muse may ask for approval before taking the write action. That approval is expected. The application records the created item and the MCP event in the database.

Important: the MCP endpoint must be deployed behind HTTPS, authentication, tenant isolation, and an allowlist before it is used with real client data. Do not expose the current sandbox endpoint as an enterprise production endpoint.

## Muse Code

Muse Code supports MCP servers through its settings file. For a local workbook directory and local Part 21 application checkout, use a `stdio` server:

```json
{
  "mcp_servers": {
    "part21-assurance-os": {
      "transport": "stdio",
      "command": "pnpm",
      "args": ["--dir", "${PART21OPS_DIR}", "mcp:stdio"],
      "env": {
        "EXCEL_ROOT": "${EXCEL_ROOT}",
        "PART21_DATA_DIR": "${PART21_DATA_DIR}"
      },
      "enabled": true,
      "mode": "required"
    }
  }
}
```

Set the variables in the shell that starts Muse Code:

```bash
export PART21OPS_DIR="$HOME/src/part21ops"
export EXCEL_ROOT="$HOME/field-workbooks"
export PART21_DATA_DIR="$HOME/.part21-assurance-data"
```

Build the local bridge once:

```bash
cd "$PART21OPS_DIR"
pnpm install
pnpm build:mcp
```

Alternatively, use the compiled bridge directly:

```json
{
  "mcp_servers": {
    "part21-assurance-os": {
      "transport": "stdio",
      "command": "node",
      "args": ["${PART21OPS_DIR}/dist/mcp-stdio.js"],
      "env": {
        "EXCEL_ROOT": "${EXCEL_ROOT}",
        "PART21_DATA_DIR": "${PART21_DATA_DIR}"
      },
      "enabled": true,
      "mode": "required"
    }
  }
}
```

After starting Muse Code, run `/mcp` and confirm that `field_kanban_create`, `field_kanban_attach`, `field_kanban_move`, and the Excel tools are visible.

## Exact field workflow

The intended real workflow is:

1. Muse captures a field statement, typed note, photo, or document.
2. Muse calls `field_kanban_create` for the selected audit.
3. Muse calls `field_kanban_attach` for the voice transcript or file.
4. The application stores the item, attachment hash, and event records in MySQL.
5. The Kanban shows the item with a red attention flag.
6. Muse or an authorized operator calls `field_kanban_move`.
7. The Part 21 agent can inspect the new item through the database-backed audit and graph workflows.
8. Human governance remains responsible for review, reportability, and final approval.

## What was not done

No Meta account was logged into from this build environment, and no custom connector was registered in the user’s Muse account. That final account-level step must happen in the user’s Muse application because it requires the user’s account, authorization, and endpoint choice.

The application-side MCP server and local bridge are implemented. The real external connection becomes active only after the deployed endpoint is registered in Muse or the local `stdio` configuration is installed in Muse Code.

## Official references

- Meta Muse connector help: https://www.meta.com/help/superintelligence/1687253048996149/
- Meta Muse Code extension and MCP configuration: https://dev.meta.ai/docs/muse-code/extending
