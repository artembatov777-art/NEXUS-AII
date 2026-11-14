import { useEffect, useMemo, useState } from "react";
import { Database, FlaskConical, RefreshCw, Save, X } from "lucide-react";
import { extractNumericExperimentMetrics, requiresExplicitDatasetTransferConfirmation, scoreDatasetEvaluation, scoreEvaluation, validateDatasetManifest, validateTrainingExperiment, type DatasetManifest, type DatasetSample, type ExperimentMethod, type TrainingExperiment } from "../core/trainingLab";
import { WorkspaceTrainingLabRepository } from "../lib/trainingLabRepository";
import { isTauri } from "@tauri-apps/api/core";
import { sendMessage } from "../lib/ai";
import { runModelComparison as executeModelComparison, summarizeModelComparison } from "../lib/modelComparison";
import { parseTrainingDatasetFile, serializeTrainingDatasetSamples } from "../lib/trainingDatasetFile";
import type { ProviderSettings } from "../types";

const splitIds = (value: string) => [...new Set(value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean))];

export function TrainingLabPanel({ onClose, provider, availableModels }: { onClose: () => void; provider: ProviderSettings; availableModels: string[] }) {
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
  const [importedSamples, setImportedSamples] = useState<DatasetSample[]>([]);
  const [modelId, setModelId] = useState("provider/model-id");
  const [comparisonModels, setComparisonModels] = useState("");
  const [method, setMethod] = useState<ExperimentMethod>("baseline");
  const [codeRevision, setCodeRevision] = useState("local-uncommitted");
  const [hardware, setHardware] = useState("Not recorded");
  const [configuration, setConfiguration] = useState('{"temperature":0}');
  const [metrics, setMetrics] = useState("{}");
  const [evaluationPrompt, setEvaluationPrompt] = useState("Explain the selected model route.");
  const [requiredPhrases, setRequiredPhrases] = useState("declared route, remote processing");
  const [candidateOutput, setCandidateOutput] = useState("");
  const [evaluationSummary, setEvaluationSummary] = useState<{ passRate: number; passedCases: number; totalCases: number } | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const [liveTestRunning, setLiveTestRunning] = useState(false);
  const liveTestAbort = useMemo(() => ({ current: null as AbortController | null }), []);

  async function refresh() {
    try {
      const [datasetResult, experimentResult] = await Promise.all([
        repository.listDatasets(), repository.listExperiments()
      ]);
      if (!datasetResult.ok) { setError(datasetResult.error.message); return; }
      if (!experimentResult.ok) { setError(experimentResult.error.message); return; }
      setDatasets(datasetResult.value);
      setSelectedDatasetKey(current => datasetResult.value.some(item => JSON.stringify([item.id, item.version]) === current) ? current : datasetResult.value[0] ? JSON.stringify([datasetResult.value[0].id, datasetResult.value[0].version]) : "");
      setExperiments(experimentResult.value);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Training Lab records.");
    }
  }
  useEffect(() => { void refresh(); }, [repository]);
  useEffect(() => () => { liveTestAbort.current?.abort(); }, [liveTestAbort]);

  function runManualEvaluation() {
    const phrases = splitIds(requiredPhrases);
    if (!evaluationPrompt.trim() || phrases.length === 0 || !candidateOutput.trim()) {
      setError("Add an evaluation prompt, at least one required phrase, and a candidate response.");
      return;
    }
    const result = scoreEvaluation(
      [{ id: "manual-case", prompt: evaluationPrompt, requiredPhrases: phrases }],
      { "manual-case": candidateOutput }
    );
    const summary = { passRate: result.passRate, passedCases: result.passedCases, totalCases: result.totalCases };
    setEvaluationSummary(summary);
    setMetrics(JSON.stringify(summary, null, 2));
    setError("");
    setStatus("Manual phrase evaluation complete. This is a deterministic regression signal, not a semantic quality score.");
  }

  async function runLiveModelTest() {
    if (!isTauri()) {
      setError("Live model testing is available in the native desktop app. Browser preview cannot access the local provider runtime.");
      return;
    }
    if (!provider.baseUrl.trim() || !provider.model.trim() || !evaluationPrompt.trim()) {
      setError("Configure a provider URL, model, and evaluation prompt first.");
      return;
    }
    liveTestAbort.current?.abort();
    const controller = new AbortController();
    liveTestAbort.current = controller;
    setLiveTestRunning(true);
    setWorking(true);
    setError("");
    setStatus("Sending the evaluation prompt to the currently selected provider...");
    const startedAt = performance.now();
    try {
      const response = await sendMessage(provider, [{
        id: crypto.randomUUID(),
        role: "user",
        content: evaluationPrompt.trim(),
        createdAt: Date.now()
      }], "", undefined, controller.signal, undefined, { temperature: 0, maxOutputTokens: 1024 });
      const elapsedMs = Math.round(performance.now() - startedAt);
      setCandidateOutput(response);
      setModelId(provider.model);
      setMetrics(JSON.stringify({ latencyMs: elapsedMs, responseCharacters: response.length }, null, 2));
      setConfiguration(JSON.stringify({ temperature: 0, maxOutputTokens: 1024, route: provider.inferenceLocation }, null, 2));
      setStatus(`Live generation completed in ${elapsedMs} ms via ${provider.model}. Review the response, then score it with the evaluation bench.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Live model test failed.");
      setStatus("");
    } finally {
      if (liveTestAbort.current === controller) liveTestAbort.current = null;
      setLiveTestRunning(false);
      setWorking(false);
    }
  }

  async function runDatasetEvaluation() {
    if (!isTauri()) {
      setError("Dataset model evaluation requires the native desktop app.");
      return;
    }
    if (!provider.model.trim()) {
      setError("Select and verify a provider model before running dataset evaluation.");
      return;
    }
    const dataset = selectedDatasetRecord;
    const testSamples = dataset?.samples?.filter(sample => sample.split === "test") ?? [];
    if (!dataset || testSamples.length === 0) {
      setError("Select a saved dataset version that contains imported test-split samples.");
      return;
    }
    if (requiresExplicitDatasetTransferConfirmation(dataset) &&
        !window.confirm(`This dataset is marked owner-approved private. Its test inputs will be sent to the configured provider endpoint (declared route: ${provider.inferenceLocation}). A local or loopback endpoint may still forward data remotely, and NEXUS cannot verify upstream routing. Expected outputs stay local. Continue?`)) return;
    if (testSamples.length > 1_000) {
      setError("A single evaluation run is limited to 1,000 test cases. Split the dataset into smaller versions to evaluate it in batches.");
      return;
    }
    liveTestAbort.current?.abort();
    const controller = new AbortController();
    liveTestAbort.current = controller;
    setLiveTestRunning(true);
    setWorking(true);
    setError("");
    setStatus(`Evaluating ${testSamples.length} held-out test samples with ${provider.model}. Expected outputs remain local.`);
    const outputs: Record<string, { response: string; latencyMs: number }> = {};
    const failures: string[] = [];
    try {
      for (const sample of testSamples) {
        if (controller.signal.aborted) throw new Error("Dataset evaluation was cancelled.");
        const startedAt = performance.now();
        try {
          const response = await sendMessage(provider, [{
            id: crypto.randomUUID(),
            role: "user",
            content: sample.input,
            createdAt: Date.now()
          }], "", undefined, controller.signal, undefined, { temperature: 0, maxOutputTokens: 1024 });
          outputs[sample.id] = { response, latencyMs: performance.now() - startedAt };
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
          failures.push(`${sample.id}: ${cause instanceof Error ? cause.message : "Provider request failed"}`);
        }
      }
      const summary = scoreDatasetEvaluation(dataset.samples ?? [], outputs);
      setModelId(provider.model);
      setMetrics(JSON.stringify({ datasetId: dataset.id, datasetVersion: dataset.version, modelId: provider.model, ...summary }, null, 2));
      setConfiguration(JSON.stringify({ temperature: 0, maxOutputTokens: 1024, route: provider.inferenceLocation, evaluationSplit: "test", expectedOutputsSentToProvider: false }, null, 2));
      setStatus(`Dataset evaluation finished: ${summary.completedCases}/${summary.totalCases} cases completed, ${summary.exactMatches} exact matches, ${summary.expectedContained} expected outputs contained. Average latency: ${summary.averageLatencyMs} ms.`);
      setError(failures.length ? failures.join(" | ") : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dataset evaluation failed.");
      setStatus("");
    } finally {
      if (liveTestAbort.current === controller) liveTestAbort.current = null;
      setLiveTestRunning(false);
      setWorking(false);
    }
  }

  async function runModelComparison() {
    if (!isTauri()) {
      setError("Live model comparison is available only in the native desktop app.");
      return;
    }
    const models = [...new Set(comparisonModels.split(/[\n,]+/).map(item => item.trim()).filter(Boolean))];
    if (models.length < 2 || models.length > 4) {
      setError("Enter between two and four distinct model IDs, separated by commas.");
      return;
    }
    if (!evaluationPrompt.trim()) {
      setError("Add an evaluation prompt before comparing models.");
      return;
    }
    const controller = new AbortController();
    liveTestAbort.current?.abort();
    liveTestAbort.current = controller;
    setLiveTestRunning(true);
    setWorking(true);
    setError("");
    setStatus("Sending the same evaluation prompt to each selected model...");
    try {
      const results = await executeModelComparison(models, async model => {
        const startedAt = performance.now();
        const response = await sendMessage({ ...provider, model }, [{
          id: crypto.randomUUID(),
          role: "user",
          content: evaluationPrompt.trim(),
          createdAt: Date.now()
        }], "", undefined, controller.signal, undefined, { temperature: 0, maxOutputTokens: 1024 });
        return { response, latencyMs: Math.round(performance.now() - startedAt) };
      }, () => controller.signal.aborted);
      const successful = results.filter(result => result.status === "fulfilled");
      const failed = results.filter(result => result.status === "rejected");
      setCandidateOutput(results.map(result => result.status === "fulfilled"
        ? `MODEL: ${result.model}\nLATENCY: ${result.value.latencyMs} ms\n\n${result.value.response}`
        : `MODEL: ${result.model}\nSTATUS: FAILED\nERROR: ${result.error}`
      ).join("\n\n════════════════════════════════\n\n"));
      setModelId(models.join(", "));
      setMetrics(JSON.stringify(summarizeModelComparison(results), null, 2));
      setConfiguration(JSON.stringify({ temperature: 0, maxOutputTokens: 1024, route: provider.inferenceLocation, comparedModels: models.length, successfulModels: successful.length, failedModels: failed.length }, null, 2));
      setStatus(failed.length
        ? `Comparison partially completed: ${successful.length} of ${models.length} models returned results. Failed models are listed above.`
        : `Comparison completed: all ${successful.length} models returned results using the same prompt.`);
      setError(failed.length ? failed.map(result => `${result.model}: ${result.error}`).join(" | ") : "");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Model comparison failed.";
      setStatus(controller.signal.aborted ? "Model comparison was cancelled. No complete result set was recorded." : "");
      setError(message);
    } finally {
      if (liveTestAbort.current === controller) liveTestAbort.current = null;
      setLiveTestRunning(false);
      setWorking(false);
    }
  }

  async function importDatasetFile(file?: File) {
    if (!file || working) return;
    setWorking(true); setError(""); setStatus("Validating explicitly selected dataset samples…");
    try {
      if (file.size > 1_000_000) throw new Error("Dataset file exceeds the 1 MB import limit.");
      const samples = parseTrainingDatasetFile(await file.text());
      setImportedSamples(samples);
      setTrainIds(samples.filter(sample => sample.split === "train").map(sample => sample.id).join("\\n"));
      setValidationIds(samples.filter(sample => sample.split === "validation").map(sample => sample.id).join("\\n"));
      setTestIds(samples.filter(sample => sample.split === "test").map(sample => sample.id).join("\\n"));
      setSourceReference("file:" + file.name);
      setStatus(`Imported ${samples.length} samples: ${samples.filter(sample => sample.split === "train").length} train, ${samples.filter(sample => sample.split === "validation").length} validation, ${samples.filter(sample => sample.split === "test").length} test. Review privacy, license, and consent metadata before saving.`);
    } catch (cause) {
      setImportedSamples([]);
      setError(cause instanceof Error ? cause.message : "Could not import dataset samples.");
      setStatus("");
    } finally { setWorking(false); }
  }

  function exportDatasetSamples(dataset: DatasetManifest) {
    if (!dataset.samples?.length) {
      setError("This manifest contains sample IDs only. Import sample data before exporting a dataset file.");
      return;
    }
    const blob = new Blob([serializeTrainingDatasetSamples(dataset.samples)], { type: "application/x-ndjson;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${dataset.id}-v${dataset.version}.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${dataset.samples.length} sample records from ${dataset.name}.`);
    setError("");
  }

  async function saveDataset() {
    setWorking(true); setError(""); setStatus("");
    try {
      const manifest: DatasetManifest = {
        schemaVersion: 1,
        id: datasetId.trim(),
        version: Math.max(0, ...datasets.filter(item => item.id === datasetId.trim()).map(item => item.version)) + 1,
        name: datasetName.trim(),
        license: license.trim(),
        privacyClass,
        consentStatus: privacyClass === "owner_approved" ? consentStatus : "not_required",
        ...(privacyClass === "owner_approved" ? { approvalReference: approvalReference.trim() } : {}),
        sourceReferences: [sourceReference.trim()],
        splits: { train: splitIds(trainIds), validation: splitIds(validationIds), test: splitIds(testIds) },
        ...(importedSamples.length ? { samples: importedSamples } : {}),
        createdAt: Date.now()
      };
      if (!validateDatasetManifest(manifest)) {
        setError("Dataset metadata is invalid. Check its license, provenance, consent, and disjoint split IDs.");
        return;
      }
      const result = await repository.saveDataset(manifest);
      if (!result.ok) setError(result.error.message);
      else { const destination = isTauri() ? "local SQLite" : "browser preview storage"; setStatus(importedSamples.length ? `Dataset version saved with ${importedSamples.length} imported sample records in ${destination}.` : `Dataset manifest saved in ${destination} with sample IDs only; no sample content was imported.`); await refresh(); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save dataset metadata.");
    } finally { setWorking(false); }
  }

  async function saveExperiment() {
    setWorking(true); setError(""); setStatus("");
    try {
      const parsedConfiguration = JSON.parse(configuration) as Record<string, unknown>;
      const parsedMetrics = extractNumericExperimentMetrics(JSON.parse(metrics));
      if (!selectedDataset) throw new Error("Save a dataset manifest before recording an experiment.");
      const [datasetManifestId, datasetManifestVersion] = JSON.parse(selectedDataset) as [string, number];
      const experiment: TrainingExperiment = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name: method + " experiment",
        modelId: modelId.trim(),
        method,
        datasetManifestId,
        datasetManifestVersion,
        codeRevision: codeRevision.trim(),
        hardware: hardware.trim(),
        configuration: parsedConfiguration,
        metrics: parsedMetrics,
        createdAt: Date.now()
      };
      if (!validateTrainingExperiment(experiment)) {
        setError("Experiment metadata is invalid. Check the model, dataset, code revision, hardware, configuration, and metrics.");
        return;
      }
      const result = await repository.saveExperiment(experiment);
      if (!result.ok) setError(result.error.message);
      else { setStatus("Experiment metadata saved. This records a run plan/result; it does not start model training."); await refresh(); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save experiment metadata.");
    } finally { setWorking(false); }
  }

  const selectedDataset = selectedDatasetKey;
  const selectedDatasetRecord = datasets.find(dataset => JSON.stringify([dataset.id, dataset.version]) === selectedDatasetKey);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="training-modal" role="dialog" aria-modal="true" aria-labelledby="training-lab-title">
      <header className="memory-header">
        <div><div className="eyebrow">MODEL DEVELOPMENT</div><h2 id="training-lab-title"><FlaskConical size={20}/> Training Lab</h2><p>Live model testing, evaluation baselines, dataset governance, and reproducible experiment records.</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close Training Lab"><X size={18}/></button>
      </header>
      <div className="training-notice">
        {isTauri() ? "Metadata is stored in the local SQLite database. Live inference and evaluation are available. Running a test or model comparison sends the evaluation prompt to the configured provider. Dataset evaluation sends only held-out test inputs; expected outputs stay local for scoring. Use only data you are comfortable sending. Fine-tuning jobs and model-weight updates are not implemented yet." : "Browser preview stores metadata in localStorage and disables live inference. In the desktop app, running a test, comparison, or dataset evaluation sends evaluation inputs to the configured provider; expected outputs stay local for scoring. Use only data you are comfortable sending."}
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
        <div className="training-two-col"><label className="secondary-btn">Import JSON / JSONL samples<input type="file" accept=".json,.jsonl,.ndjson,application/json" hidden disabled={working} onChange={event => { void importDatasetFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label><span className="training-record-counts">{importedSamples.length} sample record(s) staged for import</span></div>
        <button className="primary-btn" onClick={() => void saveDataset()} disabled={working}><Save size={14}/> Save dataset version</button>
      </div>
      <div className="training-section">
        <div className="training-section-title"><FlaskConical size={16}/> Manual evaluation bench</div>
        <label>Evaluation prompt<input value={evaluationPrompt} onChange={event => setEvaluationPrompt(event.target.value)} maxLength={8000}/></label>
        <label>Required phrases<textarea rows={2} value={requiredPhrases} onChange={event => setRequiredPhrases(event.target.value)} placeholder="Comma-separated phrases"/></label>
        <label>Candidate model output<textarea rows={4} value={candidateOutput} onChange={event => setCandidateOutput(event.target.value)} placeholder="A live model response appears here, or paste one manually"/></label>
        <div className="training-two-col"><button className="primary-btn" onClick={() => void runLiveModelTest()} disabled={working || !isTauri()}>Run live model test</button><button className="secondary-btn" onClick={runManualEvaluation} disabled={working}>Score candidate response</button></div>
        <button className="secondary-btn" onClick={() => void runDatasetEvaluation()} disabled={working || !isTauri() || !selectedDatasetRecord?.samples?.some(sample => sample.split === "test")}>Evaluate saved dataset test split ({selectedDatasetRecord?.samples?.filter(sample => sample.split === "test").length ?? 0})</button>
        <label>Model comparison IDs<input value={comparisonModels} onChange={event => setComparisonModels(event.target.value)} placeholder={availableModels.length ? availableModels.slice(0, 4).join(", ") : "model-a, model-b"} aria-describedby="training-model-hint"/></label>
        <small id="training-model-hint">{availableModels.length ? `Discovered models: ${availableModels.length}. Enter 2 to 4 IDs from the provider catalog.` : "Load the provider model catalog in Settings, then enter 2 to 4 model IDs."}</small>
        <button className="secondary-btn" onClick={() => void runModelComparison()} disabled={working || !isTauri()}>Compare selected models</button>
        {liveTestRunning && <button className="secondary-btn" onClick={() => liveTestAbort.current?.abort()}>Cancel model test</button>}
        {evaluationSummary && <div className="training-evaluation-result"><strong>{Math.round(evaluationSummary.passRate * 100)}% phrase coverage</strong><span>{evaluationSummary.passedCases}/{evaluationSummary.totalCases} case(s) passed. Metrics JSON was updated for the next experiment record.</span></div>}
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
        {selectedDatasetRecord && <button className="secondary-btn" onClick={() => exportDatasetSamples(selectedDatasetRecord)} disabled={!selectedDatasetRecord.samples?.length}>Export selected dataset samples (.jsonl)</button>}
        {datasets.map(dataset => <div className="training-record" key={dataset.id+dataset.version}><strong>{dataset.name} · v{dataset.version}</strong><small>{dataset.license} · {dataset.privacyClass} · {dataset.splits.train.length}/{dataset.splits.validation.length}/{dataset.splits.test.length} train/validation/test IDs · {dataset.samples?.length ?? 0} stored samples</small></div>)}
        {experiments.map(experiment => <div className="training-record" key={experiment.id}><strong>{experiment.name}</strong><small>{experiment.modelId} · {experiment.method} · {new Date(experiment.createdAt).toLocaleString()}</small></div>)}
        {!datasets.length && !experiments.length && <p className="global-search-empty">No Training Lab records yet.</p>}
      </div>
    </section>
  </div>;
}
