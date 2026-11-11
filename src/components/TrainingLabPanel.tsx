import { useEffect, useMemo, useState } from "react";
import { Database, FlaskConical, RefreshCw, Save, X } from "lucide-react";
import { validateDatasetManifest, validateTrainingExperiment, type DatasetManifest, type ExperimentMethod, type TrainingExperiment } from "../core/trainingLab";
import { WorkspaceTrainingLabRepository } from "../lib/trainingLabRepository";
import { isTauri } from "@tauri-apps/api/core";

const splitIds = (value: string) => [...new Set(value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean))];

export function TrainingLabPanel({ onClose }: { onClose: () => void }) {
  const repository = useMemo(() => new WorkspaceTrainingLabRepository(window.localStorage), []);
  const [datasets, setDatasets] = useState<DatasetManifest[]>([]);
  const [selectedDatasetKey, setSelectedDatasetKey] = useState("");
  const [experiments, setExperiments] = useState<TrainingExperiment[]>([]);
  const [datasetId, setDatasetId] = useState("nexus-baseline");
  const [datasetName, setDatasetName] = useState("NEXUS baseline dataset");
  const [license, setLicense] = useState("CC0-1.0");
  const [sourceReference, setSourceReference] = useState("generated:owner-curated");
  const [privacyClass, setPrivacyClass] = useState<DatasetManifest["privacyClass"]>("synthetic");
  const [consentStatus, setConsentStatus] = useState<DatasetManifest["consentStatus"]>("not_required");
  const [approvalReference, setApprovalReference] = useState("");
  const [trainIds, setTrainIds] = useState("train-001");
  const [validationIds, setValidationIds] = useState("validation-001");
  const [testIds, setTestIds] = useState("test-001");
  const [modelId, setModelId] = useState("provider/model-id");
  const [method, setMethod] = useState<ExperimentMethod>("baseline");
  const [codeRevision, setCodeRevision] = useState("local-uncommitted");
  const [hardware, setHardware] = useState("Not recorded");
  const [configuration, setConfiguration] = useState('{"temperature":0}');
  const [metrics, setMetrics] = useState("{}");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);

  async function refresh() {
    const [datasetResult, experimentResult] = await Promise.all([
      repository.listDatasets(), repository.listExperiments()
    ]);
    if (!datasetResult.ok) { setError(datasetResult.error.message); return; }
    if (!experimentResult.ok) { setError(experimentResult.error.message); return; }
    setDatasets(datasetResult.value);
    setSelectedDatasetKey(current => datasetResult.value.some(item => JSON.stringify([item.id, item.version]) === current) ? current : datasetResult.value[0] ? JSON.stringify([datasetResult.value[0].id, datasetResult.value[0].version]) : "");
    setExperiments(experimentResult.value);
    setError("");
  }
  useEffect(() => { void refresh(); }, [repository]);

  async function saveDataset() {
    setWorking(true); setError(""); setStatus("");
    const manifest: DatasetManifest = {
      schemaVersion: 1,
      id: datasetId.trim(),
      version: Math.max(0, ...datasets.filter(item => item.id === datasetId.trim()).map(item => item.version)) + 1,
      name: datasetName.trim(),
      license: license.trim(),
      privacyClass,
      consentStatus,
      ...(privacyClass === "owner_approved" ? { approvalReference: approvalReference.trim() } : {}),
      sourceReferences: [sourceReference.trim()],
      splits: { train: splitIds(trainIds), validation: splitIds(validationIds), test: splitIds(testIds) },
      createdAt: Date.now()
    };
    if (!validateDatasetManifest(manifest)) {
      setError("Dataset metadata is invalid. Check its license, provenance, consent, and disjoint split IDs.");
      setWorking(false);
      return;
    }
    const result = await repository.saveDataset(manifest);
    if (!result.ok) setError(result.error.message);
    else { setStatus("Dataset manifest saved. No raw sample content was copied into Training Lab."); await refresh(); }
    setWorking(false);
  }

  async function saveExperiment() {
    setWorking(true); setError(""); setStatus("");
    let parsedConfiguration: Record<string, unknown>;
    let parsedMetrics: Record<string, number>;
    try {
      parsedConfiguration = JSON.parse(configuration) as Record<string, unknown>;
      parsedMetrics = JSON.parse(metrics) as Record<string, number>;
    } catch {
      setError("Configuration and metrics must be valid JSON objects.");
      setWorking(false);
      return;
    }
    const experiment: TrainingExperiment = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      name: method + " experiment",
      modelId: modelId.trim(),
      method,
      datasetManifestId: (JSON.parse(selectedDataset) as [string, number])[0],
      datasetManifestVersion: (JSON.parse(selectedDataset) as [string, number])[1],
      codeRevision: codeRevision.trim(),
      hardware: hardware.trim(),
      configuration: parsedConfiguration,
      metrics: parsedMetrics,
      createdAt: Date.now()
    };
    if (!validateTrainingExperiment(experiment)) {
      setError("Experiment metadata is invalid. Check the model, dataset, code revision, hardware, configuration, and metrics.");
      setWorking(false);
      return;
    }
    const result = await repository.saveExperiment(experiment);
    if (!result.ok) setError(result.error.message);
    else { setStatus("Experiment metadata saved. This records a run plan/result; it does not start model training."); await refresh(); }
    setWorking(false);
  }

  const selectedDataset = selectedDatasetKey;
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="training-modal" role="dialog" aria-modal="true" aria-labelledby="training-lab-title">
      <header className="memory-header">
        <div><div className="eyebrow">MODEL DEVELOPMENT</div><h2 id="training-lab-title"><FlaskConical size={20}/> Training Lab</h2><p>Dataset governance, evaluation baselines, and reproducible experiment metadata.</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close Training Lab"><X size={18}/></button>
      </header>
      <div className="training-notice">
        {isTauri() ? "Metadata is stored in the local SQLite database. Training jobs and model-weight updates are not implemented yet." : "Browser preview stores metadata in localStorage. Native SQLite persistence is available in the desktop app."}
        <br/>Private conversations, memories, and raw sample text are not imported automatically.
      </div>
      {error && <div className="error-banner">{error}</div>}
      {status && <div className="knowledge-status">{status}</div>}
      <div className="training-section">
        <div className="training-section-title"><Database size={16}/> Register dataset manifest</div>
        <div className="training-two-col">
          <label>Dataset ID<input value={datasetId} onChange={event => setDatasetId(event.target.value)} maxLength={160}/></label>
          <label>Dataset name<input value={datasetName} onChange={event => setDatasetName(event.target.value)} maxLength={160}/></label>
        </div>
        <div className="training-two-col">
          <label>License<input value={license} onChange={event => setLicense(event.target.value)} placeholder="CC0-1.0"/></label>
          <label>Source reference<input value={sourceReference} onChange={event => setSourceReference(event.target.value)} placeholder="URL, archive, or generated dataset ID"/></label>
        </div>
        <div className="training-two-col">
          <label>Privacy class<select value={privacyClass} onChange={event => setPrivacyClass(event.target.value as DatasetManifest["privacyClass"])}><option value="synthetic">Synthetic</option><option value="public">Public</option><option value="owner_approved">Owner-approved private</option></select></label>
          <label>Consent status<select value={privacyClass === "owner_approved" ? consentStatus : "not_required"} disabled={privacyClass !== "owner_approved"} onChange={event => setConsentStatus(event.target.value as DatasetManifest["consentStatus"])}><option value="not_required">Not required</option><option value="approved">Approved</option></select></label>
        </div>
        {privacyClass === "owner_approved" && <label>Approval reference<input value={approvalReference} onChange={event => setApprovalReference(event.target.value)} placeholder="Explicit owner approval reference"/></label>}
        <div className="training-splits">
          <label>Train sample IDs<textarea rows={2} value={trainIds} onChange={event => setTrainIds(event.target.value)} placeholder="One ID per line or comma-separated"/></label>
          <label>Validation sample IDs<textarea rows={2} value={validationIds} onChange={event => setValidationIds(event.target.value)} placeholder="One ID per line or comma-separated"/></label>
          <label>Test sample IDs<textarea rows={2} value={testIds} onChange={event => setTestIds(event.target.value)} placeholder="One ID per line or comma-separated"/></label>
        </div>
        <button className="primary-btn" onClick={() => void saveDataset()} disabled={working}><Save size={14}/> Save dataset manifest</button>
      </div>
      <div className="training-section">
        <div className="training-section-title"><FlaskConical size={16}/> Record experiment</div>
        <div className="training-two-col">
          <label>Model ID<input value={modelId} onChange={event => setModelId(event.target.value)} placeholder="provider/model-id"/></label>
          <label>Method<select value={method} onChange={event => setMethod(event.target.value as ExperimentMethod)}><option value="baseline">Baseline</option><option value="prompting">Prompting</option><option value="retrieval">Retrieval</option><option value="tooling">Tooling</option><option value="lora">LoRA adapter</option></select></label>
        </div>
        <div className="training-two-col">
          <label>Code revision<input value={codeRevision} onChange={event => setCodeRevision(event.target.value)} placeholder="Git commit SHA"/></label>
          <label>Hardware<input value={hardware} onChange={event => setHardware(event.target.value)} placeholder="CPU/GPU and memory"/></label>
        </div>
        <label>Dataset<select value={selectedDataset} disabled={datasets.length === 0} onChange={event => setSelectedDatasetKey(event.target.value)}>{datasets.map(dataset => <option key={dataset.id+"@"+dataset.version} value={JSON.stringify([dataset.id, dataset.version])}>{dataset.name} · v{dataset.version}</option>)}</select></label>
        <div className="training-two-col">
          <label>Configuration JSON<textarea rows={3} value={configuration} onChange={event => setConfiguration(event.target.value)}/></label>
          <label>Metrics JSON<textarea rows={3} value={metrics} onChange={event => setMetrics(event.target.value)}/></label>
        </div>
        <button className="primary-btn" onClick={() => void saveExperiment()} disabled={working || datasets.length === 0}><Save size={14}/> Save experiment record</button>
      </div>
      <div className="training-section">
        <div className="training-section-title"><RefreshCw size={15}/> Saved records</div>
        <div className="training-record-counts"><span>{datasets.length} dataset version(s)</span><span>{experiments.length} experiment(s)</span><button className="icon-btn" onClick={() => void refresh()} aria-label="Refresh Training Lab records"><RefreshCw size={14}/></button></div>
        {datasets.map(dataset => <div className="training-record" key={dataset.id+dataset.version}><strong>{dataset.name} · v{dataset.version}</strong><small>{dataset.license} · {dataset.privacyClass} · {dataset.splits.train.length}/{dataset.splits.validation.length}/{dataset.splits.test.length} train/validation/test IDs</small></div>)}
        {experiments.map(experiment => <div className="training-record" key={experiment.id}><strong>{experiment.name}</strong><small>{experiment.modelId} · {experiment.method} · {new Date(experiment.createdAt).toLocaleString()}</small></div>)}
        {!datasets.length && !experiments.length && <p className="global-search-empty">No Training Lab records yet.</p>}
      </div>
    </section>
  </div>;
}
