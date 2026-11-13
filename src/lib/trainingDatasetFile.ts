import type { DatasetSample } from "../core/trainingLab";

const MAX_FILE_BYTES = 1_000_000;
const MAX_SAMPLES = 300_000;

export function parseTrainingDatasetFile(text: string): DatasetSample[] {
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
    throw new Error("Dataset file exceeds the 1 MB import limit.");
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Dataset file is empty.");
  let values: unknown[];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("JSON dataset must contain an array of samples.");
    values = parsed;
  } else {
    values = trimmed.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      try { return JSON.parse(line) as unknown; }
      catch { throw new Error(`Invalid JSON on dataset line ${index + 1}.`); }
    });
  }
  if (values.length > MAX_SAMPLES) throw new Error("Dataset contains too many samples.");
  const samples: DatasetSample[] = [];
  const ids = new Set<string>();
  let contentBytes = 0;
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Every dataset row must be a JSON object.");
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 160 ||
        typeof item.input !== "string" || !item.input.trim() || item.input.length > 12_000 ||
        typeof item.expectedOutput !== "string" || !item.expectedOutput.trim() || item.expectedOutput.length > 12_000 ||
        !["train", "validation", "test"].includes(String(item.split))) {
      throw new Error("Each row requires id, input, expectedOutput, and split (train, validation, or test).");
    }
    if (ids.has(item.id)) throw new Error(`Duplicate dataset sample ID: ${item.id}`);
    ids.add(item.id);
    contentBytes += new TextEncoder().encode(item.id + item.input + item.expectedOutput).byteLength;
    if (contentBytes > 900_000) throw new Error("Dataset sample content exceeds the 900 KB limit.");
    samples.push({ id: item.id, input: item.input, expectedOutput: item.expectedOutput, split: item.split as DatasetSample["split"] });
  }
  const counts = { train: 0, validation: 0, test: 0 };
  for (const sample of samples) counts[sample.split] += 1;
  if (Object.values(counts).some(count => count === 0)) {
    throw new Error("Dataset must include at least one train, validation, and test sample.");
  }
  return samples;
}

export function serializeTrainingDatasetSamples(samples: DatasetSample[]): string {
  return samples.map(sample => JSON.stringify(sample)).join("\n") + "\n";
}
