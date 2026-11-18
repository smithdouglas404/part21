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

## Existing Studio gateway merge

The application now includes a gateway mode for the existing `studio.innume.com` connector. In merged mode, the gateway:

- Fetches the existing Studio OpenAPI document from `STUDIO_UPSTREAM_OPENAPI_URL`.
- Publishes one combined OpenAPI document at `/api/v1/openapi.json`.
- Keeps every existing Studio operation unchanged.
- Adds the Part 21 operations under `/api/v1/part21/*` to avoid path and `operationId` collisions.
- Proxies unmatched `/api/v1/*` requests to `STUDIO_UPSTREAM_BASE_URL`.
- Preserves `Authorization`, `X-Client-Name`, and request IDs while forwarding.
- Uses the database-backed Part 21 connector confirmation policy for writes: the first call returns HTTP 202 and `confirm=true` is required only after human approval.

The gateway is intentionally fail-visible. It does not claim to be merged unless it is deployed at the Studio origin or mounted behind the Studio reverse proxy.

### Server-side configuration

Set these values in the deployment secret/configuration store; never put the bearer token in source control or chat:

```text
STUDIO_GATEWAY_MODE=merged
STUDIO_UPSTREAM_BASE_URL=https://<private-or-internal-existing-studio-origin>
STUDIO_UPSTREAM_OPENAPI_URL=https://<private-or-internal-existing-studio-origin>/api/v1/openapi.json
STUDIO_PUBLIC_URL=https://studio.innume.com
STUDIO_PART21_BEARER_TOKEN=<the same Studio token, entered as a protected secret>
STUDIO_BRIDGE_ACTOR=<named connector actor>
STUDIO_BRIDGE_ROLE=<authorized connector role>
STUDIO_BRIDGE_ACCESS=make_changes
```

`STUDIO_PART21_BEARER_TOKEN` is compared by SHA-256 and is never returned by the application. The configured actor, role, audit scope, and access level are applied to Part 21 calls made with that shared token. If the Studio deployment cannot provide the same token to the Part 21 gateway, use a separate Part 21 token instead and keep the existing Studio connector unchanged.

The merge status is visible at:

```text
GET https://studio.innume.com/api/v1/studio/merge-status
```

A successful merged deployment reports `mode: "merged"`, an upstream configuration, and `sharedBearerTokenConfigured: true`. The live OpenAPI document must contain paths such as:

```text
/api/v1/part21/field/kanban/list
/api/v1/part21/field/kanban/create
/api/v1/part21/field/kanban/move
/api/v1/part21/field/kanban/attach
/api/v1/part21/audit/brief
```

### Meta Muse after deployment

Keep the existing Meta Muse custom connector pointed at:

```text
https://studio.innume.com/api/v1/openapi.json
```

Refresh the imported schema or recreate the connector after the merged deployment is live. Keep:

```text
Auth type: Bearer token
Optional header: X-Client-Name: Meta Muse
```

Then test the read path:

```text
Show the field Kanban items waiting for review in audit AUD-026 using the Part 21 Assurance OS tools.
```

Test the human-gated write path:

```text
Create a high-priority field Kanban item for audit AUD-026 titled "Receiving record requires supervisor review".
```

Muse should first receive a confirmation preview. The item must not be written until the person approves and Muse repeats the same operation with `confirm: true`. The created item and `kanban_item_created` event are persisted in the Part 21 database.

### Current boundary

The gateway implementation and OpenAPI merge tests are in this project. This sandbox does not possess the private upstream origin, the `studio.innume.com` deployment binding, or the existing bearer token, so the domain-level cutover cannot be executed from here. The merge becomes live only when this gateway is deployed at the Studio origin or its reverse proxy is configured to route `/api/v1/part21/*` and `/api/v1/openapi.json` through it.
