import { describe, expect, it } from "vitest";
import {
  scoreDatasetEvaluation,
  scoreEvaluation,
  validateDatasetManifest,
  validateTrainingExperiment,
  type DatasetManifest,
  type TrainingExperiment
} from "./trainingLab";

const manifest: DatasetManifest = {
  schemaVersion: 1,
  id: "dataset-baseline-v1",
  version: 1,
  name: "Public baseline evaluation set",
  license: "CC0-1.0",
  privacyClass: "synthetic",
  consentStatus: "not_required",
  sourceReferences: ["generated:baseline-v1"],
  splits: {
    train: ["train-1", "train-2"],
    validation: ["validation-1"],
    test: ["test-1"]
  },
  createdAt: 1_800_000_000_000
};

const experiment: TrainingExperiment = {
  schemaVersion: 1,
  id: "experiment-001",
  name: "Baseline evaluation",
  modelId: "gateway/model-a",
  method: "baseline",
  datasetManifestId: manifest.id,
  datasetManifestVersion: manifest.version,
  codeRevision: "abc1234",
  hardware: "CI runner",
  configuration: { temperature: 0, maxOutputTokens: 256 },
  metrics: { passRate: 0.75, latencyMs: 420 },
  createdAt: 1_800_000_000_000
};

describe("Training Lab governance", () => {
  it("accepts a versioned synthetic dataset with disjoint splits", () => {
    expect(validateDatasetManifest(manifest)).toBe(true);
  });

  it("rejects owner-selected datasets without approved consent", () => {
    expect(validateDatasetManifest({
      ...manifest,
      privacyClass: "owner_approved",
      consentStatus: "not_required",
      approvalReference: "owner-approval-001"
    })).toBe(false);
  });

  it("rejects datasets with pending consent", () => {
    expect(validateDatasetManifest({ ...manifest, consentStatus: "pending" })).toBe(false);
  });

  it("requires explicit approval provenance for owner-selected data", () => {
    expect(validateDatasetManifest({ ...manifest, privacyClass: "owner_approved" })).toBe(false);
    expect(validateDatasetManifest({
      ...manifest,
      privacyClass: "owner_approved",
      consentStatus: "approved",
      approvalReference: "owner-approval-001"
    })).toBe(true);
  });

  it("rejects overlapping train, validation, and test splits", () => {
    expect(validateDatasetManifest({
      ...manifest,
      splits: { train: ["shared"], validation: ["shared"], test: [] }
    })).toBe(false);
  });

  it("requires all three dataset splits to contain at least one sample", () => {
    expect(validateDatasetManifest({
      ...manifest,
      splits: { train: ["train"], validation: [], test: ["test"] }
    })).toBe(false);
  });

  it("rejects duplicate IDs within a split", () => {
    expect(validateDatasetManifest({
      ...manifest,
      splits: { train: ["same", "same"], validation: [], test: [] }
    })).toBe(false);
  });

  it("accepts imported dataset samples when every sample matches exactly one declared split", () => {
    const withSamples: DatasetManifest = {
      ...manifest,
      samples: [
        { id: "train-1", split: "train", input: "prompt one", expectedOutput: "answer one" },
        { id: "train-2", split: "train", input: "prompt two", expectedOutput: "answer two" },
        { id: "validation-1", split: "validation", input: "validation prompt", expectedOutput: "validation answer" },
        { id: "test-1", split: "test", input: "test prompt", expectedOutput: "test answer" }
      ]
    };
    expect(validateDatasetManifest(withSamples)).toBe(true);
  });

  it("rejects imported samples assigned to the wrong split or missing sample IDs", () => {
    const withSamples: DatasetManifest = {
      ...manifest,
      samples: [{ id: "train-1", split: "test", input: "prompt", expectedOutput: "answer" }]
    };
    expect(validateDatasetManifest(withSamples)).toBe(false);
  });

  it("accepts experiment records without secret-bearing configuration", () => {
    expect(validateTrainingExperiment(experiment)).toBe(true);
  });

  it("rejects secrets hidden beyond the maximum configuration depth", () => {
    expect(validateTrainingExperiment({
      ...experiment,
      configuration: { a: { b: { c: { d: { e: { f: { g: { h: { apiKey: "secret" } } } } } } } } }
    })).toBe(false);
  });

  it("rejects raw prompts and conversation payloads in experiment configuration", () => {
    expect(validateTrainingExperiment({
      ...experiment,
      configuration: { context: { promptTemplate: "private prompt" } }
    })).toBe(false);
  });

  it("rejects secrets in experiment configuration", () => {
    expect(validateTrainingExperiment({
      ...experiment,
      configuration: { runtime: { apiKey: "must-not-be-saved" } }
    })).toBe(false);
  });

  it("scores required phrases without modifying the source evaluation cases", () => {
    const cases = [
      { id: "a", prompt: "Question A", requiredPhrases: ["alpha", "beta"] },
      { id: "b", prompt: "Question B", requiredPhrases: ["gamma"] }
    ];
    const result = scoreEvaluation(cases, { a: "Alpha and beta", b: "no match" });
    expect(result).toMatchObject({ totalCases: 2, passedCases: 1, passRate: 0.5 });
    expect(result.results[0].matchedPhrases).toBe(2);
    expect(cases[0].requiredPhrases).toEqual(["alpha", "beta"]);
  });

  it("scores only held-out test samples and reports latency and failed cases", () => {
    const samples = [
      { id: "train-1", split: "train" as const, input: "training", expectedOutput: "ignored" },
      { id: "test-1", split: "test" as const, input: "question", expectedOutput: "The answer" },
      { id: "test-2", split: "test" as const, input: "another", expectedOutput: "missing" }
    ];
    const result = scoreDatasetEvaluation(samples, {
      "test-1": { response: "  The   answer  ", latencyMs: 120 },
    });
    expect(result).toMatchObject({
      totalCases: 2, completedCases: 1, failedCases: 1,
      exactMatches: 1, exactMatchRate: 0.5,
      expectedContained: 1, expectedContainedRate: 0.5,
      averageLatencyMs: 120
    });
    expect(result.results.map(item => item.sampleId)).toEqual(["test-1", "test-2"]);
  });

  it("returns a zero score for an empty evaluation suite", () => {
    expect(scoreEvaluation([], {})).toMatchObject({ totalCases: 0, passedCases: 0, passRate: 0 });
  });
});
