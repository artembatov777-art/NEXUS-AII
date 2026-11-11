import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  validateDatasetManifest,
  validateTrainingExperiment,
  type DatasetManifest,
  type TrainingExperiment,
  type TrainingLabRepository
} from "../core/trainingLab";
import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";

const STORAGE_KEY = "nexus-au:training-lab:v1";

type StoredTrainingLab = { datasets: DatasetManifest[]; experiments: TrainingExperiment[] };

function readLocal(storage: StorageLike): Result<StoredTrainingLab> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return ok({ datasets: [], experiments: [] });
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return err("storage_failed", "Training Lab storage is invalid.");
    }
    const candidate = value as Partial<StoredTrainingLab>;
    if (!Array.isArray(candidate.datasets) || !candidate.datasets.every(validateDatasetManifest)
        || !Array.isArray(candidate.experiments) || !candidate.experiments.every(validateTrainingExperiment)) {
      return err("storage_failed", "Training Lab storage contains invalid or unsupported records.");
    }
    return ok({ datasets: candidate.datasets, experiments: candidate.experiments });
  } catch {
    return err("storage_failed", "Could not read Training Lab storage.", true);
  }
}

function writeLocal(storage: StorageLike, value: StoredTrainingLab): Result<void> {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
    return ok(undefined);
  } catch {
    return err("storage_failed", "Could not persist Training Lab metadata.", true);
  }
}

export class WorkspaceTrainingLabRepository implements TrainingLabRepository {
  constructor(private readonly storage: StorageLike) {}

  async listDatasets(): Promise<Result<DatasetManifest[]>> {
    if (isTauri()) {
      try {
        const records = await invoke<unknown[]>("list_training_datasets");
        return records.every(validateDatasetManifest)
          ? ok(records)
          : err("storage_failed", "Native Training Lab dataset storage returned invalid records.");
      } catch (cause) {
        return err("storage_failed", cause instanceof Error ? cause.message : "Could not load training datasets.", true);
      }
    }
    const stored = readLocal(this.storage);
    return stored.ok ? ok(stored.value.datasets) : stored;
  }

  async saveDataset(manifest: DatasetManifest): Promise<Result<void>> {
    if (!validateDatasetManifest(manifest)) return err("validation", "Training dataset manifest failed governance validation.");
    if (isTauri()) {
      try {
        await invoke("save_training_dataset", { manifest });
        return ok(undefined);
      } catch (cause) {
        return err("storage_failed", cause instanceof Error ? cause.message : "Could not save training dataset.");
      }
    }
    const stored = readLocal(this.storage);
    if (!stored.ok) return stored;
    const existing = stored.value.datasets.find(item => item.id === manifest.id && item.version === manifest.version);
    if (existing) {
      return JSON.stringify(existing) === JSON.stringify(manifest)
        ? ok(undefined)
        : err("validation", "Dataset versions are immutable; create a new version instead.");
    }
    return writeLocal(this.storage, { ...stored.value, datasets: [...stored.value.datasets, manifest] });
  }

  async listExperiments(): Promise<Result<TrainingExperiment[]>> {
    if (isTauri()) {
      try {
        const records = await invoke<unknown[]>("list_training_experiments");
        return records.every(validateTrainingExperiment)
          ? ok(records)
          : err("storage_failed", "Native Training Lab experiment storage returned invalid records.");
      } catch (cause) {
        return err("storage_failed", cause instanceof Error ? cause.message : "Could not load training experiments.", true);
      }
    }
    const stored = readLocal(this.storage);
    return stored.ok ? ok(stored.value.experiments) : stored;
  }

  async saveExperiment(experiment: TrainingExperiment): Promise<Result<void>> {
    if (!validateTrainingExperiment(experiment)) return err("validation", "Training experiment failed metadata validation.");
    if (isTauri()) {
      try {
        await invoke("save_training_experiment", { experiment });
        return ok(undefined);
      } catch (cause) {
        return err("storage_failed", cause instanceof Error ? cause.message : "Could not save training experiment.");
      }
    }
    const stored = readLocal(this.storage);
    if (!stored.ok) return stored;
    if (!stored.value.datasets.some(item => item.id === experiment.datasetManifestId)) {
      return err("validation", "Register the referenced dataset before saving an experiment.");
    }
    const existing = stored.value.experiments.find(item => item.id === experiment.id);
    if (existing) {
      return JSON.stringify(existing) === JSON.stringify(experiment)
        ? ok(undefined)
        : err("validation", "Experiment IDs are immutable; create a new experiment instead.");
    }
    return writeLocal(this.storage, { ...stored.value, experiments: [...stored.value.experiments, experiment] });
  }
}
