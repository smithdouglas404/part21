import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "vendor/ecc");

function listMarkdown(directory: string, recursive = false) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [] as string[];
  const results: string[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && recursive) visit(full);
      if (entry.isFile() && entry.name.endsWith(".md") && (!recursive || entry.name === "SKILL.md")) results.push(path.relative(absolute, full).replace(/\.md$/, ""));
    }
  };
  visit(absolute);
  return results.sort();
}

export function getVendoredEccLibrary() {
  const agents = listMarkdown("agents");
  const skills = listMarkdown("skills", true);
  const commands = listMarkdown("commands");
  const hooks = fs.existsSync(path.join(root, "hooks")) ? fs.readdirSync(path.join(root, "hooks"), { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort() : [];
  const version = fs.existsSync(path.join(root, "VERSION")) ? fs.readFileSync(path.join(root, "VERSION"), "utf8").trim() : "vendored snapshot";
  return {
    mode: "vendored-source",
    source: "vendor/ecc",
    repository: "https://github.com/affaan-m/ecc",
    version,
    license: fs.existsSync(path.join(root, "LICENSE")) ? "MIT" : "unknown",
    counts: { agents: agents.length, skills: skills.length, commands: commands.length, hooks: hooks.length },
    samples: { agents: agents.slice(0, 12), skills: skills.slice(0, 12), commands: commands.slice(0, 12), hooks: hooks.slice(0, 12) },
    localExtensionPoint: "Northstar Part 21 skills are registered through shared/ecc.ts and surfaced beside the vendored ECC library.",
  };
}
