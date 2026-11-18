import { bundleWorkflowCode } from "@temporalio/worker";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function buildTemporalArtifacts(outputDirectory = resolve("dist/temporal")) {
  const root = dirname(fileURLToPath(import.meta.url));
  await mkdir(outputDirectory, { recursive: true });
  const workflowBundlePath = resolve(outputDirectory, "workflow-bundle.js");
  const workerEntryPath = resolve(outputDirectory, "worker-entry.js");
  const bundle = await bundleWorkflowCode({ workflowsPath: resolve(root, "workflows.ts") });
  await writeFile(workflowBundlePath, bundle.code);
  await build({ entryPoints: [resolve(root, "worker-entry.ts")], platform: "node", packages: "external", bundle: true, format: "esm", target: "node22", outfile: workerEntryPath });
  return { workflowBundlePath, workerEntryPath };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildTemporalArtifacts(process.argv[2] ? resolve(process.argv[2]) : undefined).then(result => console.info("[part21-temporal] build complete", result)).catch(error => { console.error(error); process.exitCode = 1; });
}
