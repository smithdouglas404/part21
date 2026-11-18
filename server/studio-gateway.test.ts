import { describe, expect, it } from "vitest";
import { connectOpenApi } from "./connect-api";
import { buildPart21GatewayPaths, mergeOpenApiDocuments } from "./studio-gateway";

describe("Studio + Part 21 gateway OpenAPI", () => {
  it("rehomes Part 21 connector paths without overwriting Studio paths", () => {
    const part21 = connectOpenApi("https://gateway.example") as any;
    const paths = buildPart21GatewayPaths(part21);

    expect(paths["/api/v1/part21/field/kanban/list"]).toBeDefined();
    expect(paths["/api/v1/part21/field/kanban/create"]).toBeDefined();
    expect(paths["/api/v1/part21/tools/{tool}"]).toBeDefined();
    expect((paths["/api/v1/part21/field/kanban/create"] as any).post.operationId).toBe("part21_fieldKanbanCreate");
  });

  it("preserves the existing Studio contract and adds Part 21 security metadata", () => {
    const studio = {
      openapi: "3.1.0",
      info: { title: "Socra Studio", version: "2.0.0", description: "Existing Studio contract." },
      paths: { "/api/v1/brief": { post: { operationId: "brief" } } },
      components: { securitySchemes: { token: { type: "apiKey", in: "header", name: "Authorization" } } },
    };
    const merged = mergeOpenApiDocuments(studio, connectOpenApi("https://gateway.example") as any, "https://studio.innume.com");

    expect(merged.servers).toEqual([{ url: "https://studio.innume.com" }]);
    expect(merged.paths?.["/api/v1/brief"]).toBeDefined();
    expect(merged.paths?.["/api/v1/part21/field/kanban/move"]).toBeDefined();
    expect((merged.components as any).securitySchemes.token).toBeDefined();
    expect((merged.components as any).securitySchemes.bearerAuth).toBeDefined();
    expect((merged as any)["x-part21-gateway"]).toMatchObject({ routePrefix: "/api/v1/part21", operationalData: "mysql-domain-records" });
  });
});
