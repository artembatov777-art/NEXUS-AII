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

const MAX_SPLIT_ITEMS = 100_000;
const MAX_SOURCE_REFERENCES = 500;
const MAX_CONFIG_DEPTH = 8;

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
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
      !uniqueStrings(test, MAX_SPLIT_ITEMS, 160) || test.length === 0) return false;

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
    if (!sample || !boundedText(sample.id, 160) ||
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


export interface TrainingLabRepository {
  listDatasets(): Promise<Result<DatasetManifest[]>>;
  saveDataset(manifest: DatasetManifest): Promise<Result<void>>;
  listExperiments(): Promise<Result<TrainingExperiment[]>>;
  saveExperiment(experiment: TrainingExperiment): Promise<Result<void>>;
}
