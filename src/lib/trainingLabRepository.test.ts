import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceTrainingLabRepository } from "./trainingLabRepository";
import type { StorageLike } from "./memoryStorage";
import type { DatasetManifest, TrainingExperiment } from "../core/trainingLab";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const manifest: DatasetManifest = {
  schemaVersion: 1, id: "dataset-1", version: 1, name: "Synthetic", license: "CC0-1.0",
  privacyClass: "synthetic", consentStatus: "not_required", sourceReferences: ["generated:test"],
  splits: { train: ["a"], validation: ["b"], test: ["c"] }, createdAt: 100
};
const experiment: TrainingExperiment = {
  schemaVersion: 1, id: "experiment-1", name: "Baseline", modelId: "gateway/model",
  method: "baseline", datasetManifestId: manifest.id, codeRevision: "abc1234",
  hardware: "Test runner", configuration: { temperature: 0 },
  metrics: { passRate: 0.5 }, createdAt: 200
};

describe("WorkspaceTrainingLabRepository", () => {
  let storage: MemoryStorage;
  let repository: WorkspaceTrainingLabRepository;
  beforeEach(() => { storage = new MemoryStorage(); repository = new WorkspaceTrainingLabRepository(storage); });

  it("persists versioned dataset manifests and experiment metadata", async () => {
    expect((await repository.saveDataset(manifest)).ok).toBe(true);
    expect((await repository.saveExperiment(experiment)).ok).toBe(true);
    const datasets = await repository.listDatasets();
    const experiments = await repository.listExperiments();
    expect(datasets.ok && datasets.value).toHaveLength(1);
    expect(experiments.ok && experiments.value[0]?.id).toBe("experiment-1");
  });

  it("prevents overwriting immutable dataset and experiment identities", async () => {
    await repository.saveDataset(manifest);
    await repository.saveExperiment(experiment);
    expect((await repository.saveDataset({ ...manifest, name: "Changed" })).ok).toBe(false);
    expect((await repository.saveExperiment({ ...experiment, name: "Changed" })).ok).toBe(false);
  });

  it("requires a registered dataset before saving experiment metadata", async () => {
    expect((await repository.saveExperiment(experiment)).ok).toBe(false);
  });

  it("rejects malformed stored data rather than silently resetting it", async () => {
    storage.setItem("nexus-au:training-lab:v1", JSON.stringify({ datasets: [{}], experiments: [] }));
    expect((await repository.listDatasets()).ok).toBe(false);
  });
});
