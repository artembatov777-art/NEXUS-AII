import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workflowsDirectory = resolve(".github/workflows");
const workflowFiles = readdirSync(workflowsDirectory)
  .filter(file => /\\.ya?ml$/i.test(file))
  .sort();
const problems = [];

for (const file of workflowFiles) {
  const source = readFileSync(join(workflowsDirectory, file), "utf8");
  for (const [index, line] of source.split(/\\r?\\n/).entries()) {
    const match = line.match(/^\\s*uses:\\s*([^\\s#]+)/);
    if (!match) continue;

    const action = match[1];
    if (action.startsWith("./") || action.startsWith("docker://")) continue;

    const separator = action.lastIndexOf("@");
    const revision = separator > 0 ? action.slice(separator + 1) : "";
    if (!/^[0-9a-f]{40}$/i.test(revision)) {
      problems.push(`${file}:${index + 1}: ${action} is not pinned to a full 40-character commit SHA`);
    }
  }
}

if (problems.length) {
  console.error("GitHub Actions pin validation failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Verified immutable commit pins for all external actions in ${workflowFiles.length} workflow files.`);
}
