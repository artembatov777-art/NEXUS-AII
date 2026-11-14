import type { Result } from "./result";

export type DatasetPrivacyClass = "public" | "synthetic" | "owner_approved";
export type DatasetConsentStatus = "approved" | "not_required" | "pending" | "rejected";

export interface DatasetSample {
  id: string;
  split: "train" | "validation" | "test";
  input: string;
  expectedOutput: string;
}

export interface DatasetManifest {
  schemaVersion: 1;
  id: string;
  version: number;
  name: string;
  license: string;
  privacyClass: DatasetPrivacyClass;
  consentStatus: DatasetConsentStatus;
  approvalReference?: string;
  sourceReferences: string[];
  splits: {
    train: string[];
    validation: string[];
    test: string[];
  };
  /** Optional raw evaluation/training samples, imported only by explicit owner action. */
  samples?: DatasetSample[];
  createdAt: number;
}

export type ExperimentMethod = "baseline" | "prompting" | "retrieval" | "tooling" | "lora";

/**
 * Private owner-approved samples always require an explicit transfer warning.
 * A provider's declared "local" route is not proof that a loopback endpoint
 * cannot forward requests to a remote service.
 */
export function requiresExplicitDatasetTransferConfirmation(dataset: Pick<DatasetManifest, "privacyClass">): boolean {
  return dataset.privacyClass === "owner_approved";
}

export interface TrainingExperiment {
  schemaVersion: 1;
  id: string;
  name: string;
  modelId: string;
  method: ExperimentMethod;
  datasetManifestId: string;
  datasetManifestVersion: number;
  codeRevision: string;
  hardware: string;
  configuration: Record<string, unknown>;
  metrics: Record<string, number>;
  createdAt: number;
}

export interface EvaluationCase {
  id: string;
  prompt: string;
  requiredPhrases: string[];
}

export interface EvaluationCaseResult {
  caseId: string;
  passed: boolean;
  matchedPhrases: number;
  requiredPhrases: number;
}

export interface EvaluationSummary {
  totalCases: number;
  passedCases: number;
  passRate: number;
  results: EvaluationCaseResult[];
}

export interface DatasetEvaluationCaseResult {
  sampleId: string;
  exactMatch: boolean;
  expectedContained: boolean;
  latencyMs: number | null;
}

export interface DatasetEvaluationSummary {
  totalCases: number;
  completedCases: number;
  failedCases: number;
  exactMatches: number;
  exactMatchRate: number;
  expectedContained: number;
  expectedContainedRate: number;
  averageLatencyMs: number;
  results: DatasetEvaluationCaseResult[];
}

const MAX_SPLIT_ITEMS = 100_000;
const MAX_SOURCE_REFERENCES = 500;
const MAX_CONFIG_DEPTH = 8;

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validSampleId(value: unknown): value is string {
  return boundedText(value, 160) && value.trim() === value &&
    !/[\u0000-\u001f\u007f,]/.test(value);
}

function uniqueStrings(values: unknown, maxItems: number, maxLength: number): values is string[] {
  return Array.isArray(values) && values.length <= maxItems &&
    values.every(value => boundedText(value, maxLength)) &&
    new Set(values).size === values.length;
}

export function validateDatasetManifest(value: unknown): value is DatasetManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Partial<DatasetManifest>;
  if (manifest.schemaVersion !== 1 || !boundedText(manifest.id, 160) ||
      !Number.isSafeInteger(manifest.version) || (manifest.version ?? 0) < 1 ||
      !boundedText(manifest.name, 160) || !boundedText(manifest.license, 300) ||
      !["public", "synthetic", "owner_approved"].includes(manifest.privacyClass ?? "") ||
      !["approved", "not_required"].includes(manifest.consentStatus ?? "") ||
      !uniqueStrings(manifest.sourceReferences, MAX_SOURCE_REFERENCES, 500) ||
      !Number.isFinite(manifest.createdAt)) return false;

  if (manifest.sourceReferences.length === 0) return false;
  if (manifest.privacyClass === "owner_approved" && (manifest.consentStatus !== "approved" || !boundedText(manifest.approvalReference, 300))) return false;
  if (!manifest.splits || typeof manifest.splits !== "object") return false;
  const { train, validation, test } = manifest.splits;
  if (!uniqueStrings(train, MAX_SPLIT_ITEMS, 160) || train.length === 0 ||
      !uniqueStrings(validation, MAX_SPLIT_ITEMS, 160) || validation.length === 0 ||
      !uniqueStrings(test, MAX_SPLIT_ITEMS, 160) || test.length === 0 ||
      [...train, ...validation, ...test].some(id => !validSampleId(id))) return false;

  const allIds = [...train, ...validation, ...test];
  if (new Set(allIds).size !== allIds.length) return false;
  if (manifest.samples === undefined) return true;
  if (!Array.isArray(manifest.samples) || manifest.samples.length !== allIds.length || manifest.samples.length > MAX_SPLIT_ITEMS * 3) return false;
  const splitById = new Map<string, DatasetSample["split"]>();
  train.forEach(id => splitById.set(id, "train"));
  validation.forEach(id => splitById.set(id, "validation"));
  test.forEach(id => splitById.set(id, "test"));
  const sampleIds = new Set<string>();
  let totalBytes = 0;
  for (const sample of manifest.samples) {
    if (!sample || !validSampleId(sample.id) ||
        !["train", "validation", "test"].includes(sample.split) ||
        !boundedText(sample.input, 12_000) || !boundedText(sample.expectedOutput, 12_000) ||
        sampleIds.has(sample.id) || splitById.get(sample.id) !== sample.split) return false;
    sampleIds.add(sample.id);
    totalBytes += new TextEncoder().encode(sample.id + sample.input + sample.expectedOutput).byteLength;
    if (totalBytes > 900_000) return false;
  }
  return sampleIds.size === allIds.length && allIds.every(id => sampleIds.has(id));
}

function containsSensitiveKey(value: unknown, depth = 0): boolean {
  if (depth > MAX_CONFIG_DEPTH) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => containsSensitiveKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /(api.?key|access.?token|password|secret|credential|authorization|prompt|messages|conversation|raw.?data|sample.?text)/i.test(key) ||
    containsSensitiveKey(child, depth + 1)
  );
}

export function validateTrainingExperiment(value: unknown): value is TrainingExperiment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const experiment = value as Partial<TrainingExperiment>;
  if (experiment.schemaVersion !== 1 ||
      !boundedText(experiment.id, 160) ||
      !boundedText(experiment.name, 160) ||
      !boundedText(experiment.modelId, 160) ||
      !["baseline", "prompting", "retrieval", "tooling", "lora"].includes(experiment.method ?? "") ||
      !boundedText(experiment.datasetManifestId, 160) ||
      !Number.isSafeInteger(experiment.datasetManifestVersion) || (experiment.datasetManifestVersion ?? 0) < 1 ||
      !boundedText(experiment.codeRevision, 80) ||
      !boundedText(experiment.hardware, 300) ||
      !experiment.configuration || typeof experiment.configuration !== "object" ||
      Array.isArray(experiment.configuration) || containsSensitiveKey(experiment.configuration) ||
      !experiment.metrics || typeof experiment.metrics !== "object" ||
      Array.isArray(experiment.metrics) || !Number.isFinite(experiment.createdAt)) return false;

  const metricEntries = Object.entries(experiment.metrics);
  if (metricEntries.length > 100) return false;
  if (metricEntries.some(([key, metric]) => !boundedText(key, 80) || typeof metric !== "number" || !Number.isFinite(metric))) return false;
  return true;
}

export function scoreDatasetEvaluation(
  samples: DatasetSample[],
  outputs: Record<string, { response: string; latencyMs: number }>
): DatasetEvaluationSummary {
  const testSamples = samples.filter(sample => sample.split === "test");
  const results = testSamples.map(sample => {
    const output = outputs[sample.id];
    if (!output || typeof output.response !== "string" || !Number.isFinite(output.latencyMs) || output.latencyMs < 0) {
      return { sampleId: sample.id, exactMatch: false, expectedContained: false, latencyMs: null };
    }
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const actual = normalize(output.response);
    const expected = normalize(sample.expectedOutput);
    return {
      sampleId: sample.id,
      exactMatch: actual === expected,
      expectedContained: expected.length > 0 && actual.includes(expected),
      latencyMs: Math.round(output.latencyMs)
    };
  });
  const completed = results.filter(result => result.latencyMs !== null);
  const exactMatches = results.filter(result => result.exactMatch).length;
  const expectedContained = results.filter(result => result.expectedContained).length;
  return {
    totalCases: results.length,
    completedCases: completed.length,
    failedCases: results.length - completed.length,
    exactMatches,
    exactMatchRate: results.length === 0 ? 0 : exactMatches / results.length,
    expectedContained,
    expectedContainedRate: results.length === 0 ? 0 : expectedContained / results.length,
    averageLatencyMs: completed.length === 0 ? 0 : Math.round(completed.reduce((total, result) => total + (result.latencyMs ?? 0), 0) / completed.length),
    results
  };
}

export function scoreEvaluation(cases: EvaluationCase[], outputs: Record<string, string>): EvaluationSummary {
  const results = cases.map(testCase => {
    const output = (outputs[testCase.id] ?? "").toLocaleLowerCase();
    const required = testCase.requiredPhrases.map(phrase => phrase.toLocaleLowerCase());
    const matchedPhrases = required.filter(phrase => output.includes(phrase)).length;
    return {
      caseId: testCase.id,
      passed: required.length > 0 && matchedPhrases === required.length,
      matchedPhrases,
      requiredPhrases: required.length
    };
  });
  const passedCases = results.filter(result => result.passed).length;
  return {
    totalCases: results.length,
    passedCases,
    passRate: results.length === 0 ? 0 : passedCases / results.length,
    results
  };
}



/**
 * Experiment records intentionally store only finite numeric metrics.
 * Evaluation detail, raw responses, prompts, and per-case payloads stay in
 * the visible report rather than being copied into durable experiment metadata.
 */
export function extractNumericExperimentMetrics(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Experiment metrics must be a JSON object.");
  }
  const entries: Array<[string, number]> = [];
  const visit = (record: Record<string, unknown>, prefix = "", depth = 0) => {
    if (depth > 3) return;
    for (const [key, metric] of Object.entries(record)) {
      const path = prefix ? prefix + "." + key : key;
      if (!boundedText(path, 80) || /(api.?key|password|secret|credential|authorization|prompt|messages|conversation|raw.?data|sample.?text)/i.test(path)) continue;
      if (typeof metric === "number" && Number.isFinite(metric)) entries.push([path, metric]);
      else if (metric && typeof metric === "object" && !Array.isArray(metric)) {
        visit(metric as Record<string, unknown>, path, depth + 1);
      }
    }
  };
  visit(value as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error("Run an evaluation that produces numeric metrics before saving an experiment.");
  }
  if (entries.length > 100 || new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error("Experiment metrics exceed the supported metadata limits.");
  }
  return Object.fromEntries(entries);
}

export interface TrainingLabRepository {
  listDatasets(): Promise<Result<DatasetManifest[]>>;
  saveDataset(manifest: DatasetManifest): Promise<Result<void>>;
  listExperiments(): Promise<Result<TrainingExperiment[]>>;
  saveExperiment(experiment: TrainingExperiment): Promise<Result<void>>;
}
