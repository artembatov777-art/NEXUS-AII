import { t } from "../lib/i18n";
import { agentThreads } from "../lib/agentThreads";
import { AgentRunManager, type ManagedRunEvent } from "../lib/agentRunManager";
import { ModelRouter } from "../core/model";
import { WORKSPACE_TEST_MODEL, WORKSPACE_TEST_PROVIDER, WORKSPACE_TEST_TOOLS, workspaceTestProvider } from "../lib/workspaceTestProvider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Activity, AlertTriangle, Bot, Check, Clock3, Play, RefreshCw, Shield, Sparkles, X } from "lucide-react";
import type { AgentCheckpoint } from "../core/agentCheckpoints";
import type { AgentRunId } from "../core/agents";
import type { ProviderSettings } from "../types";
import type { ToolAuditEvent } from "../core/tools";
import type { TraceEvent } from "../core/observability";
import type { AmbiguousToolStep } from "../core/toolReconciliation";
import { createTauriAutoModelRouterForProfiles, NATIVE_MODEL_PROVIDER_ID } from "../lib/tauriModelProvider";
import { loadProviderProfiles } from "../lib/providerProfiles";
import { TOOL_INVOCATION_AGENT_ID } from "../core/toolInvocationAgent";
import type { ResumableAgentEvent } from "../core/resumableAgents";
import { createWorkspaceNexusRuntime } from "../lib/nexusRuntime";
import { registerWorkspaceTools } from "../lib/workspaceTools";
import { BUILT_IN_AGENT_CATALOG, BUILT_IN_AGENT_IDS, createLocalWorkflowDefinition, registerBuiltInAgentSuite } from "../lib/agentCatalog";
import { DEFAULT_AGENT_PROFILE, loadAgentProfile, saveAgentProfile, validateAgentProfile, type AgentProfile } from "../lib/agentProfile";
import { loadMcpServerConfigs } from "../lib/mcpServerStorage";
import { canUseAgentProvider } from "../lib/agentProviderAvailability";
import { HybridMemoryRetriever } from "../core/knowledge";
import { WorkspaceMemoryRepository } from "../lib/nativeRepositories";
import { LocalStorageMemoryRepository } from "../lib/memoryStorage";
import { LocalTransformerEmbeddingProvider } from "../lib/localEmbeddings";
import { IndexedDbMemoryVectorIndex } from "../lib/memoryVectorIndex";


type RuntimeBundle = ReturnType<typeof createWorkspaceNexusRuntime>;
type RuntimeState = { runtime: RuntimeBundle | null; error: string; profile: AgentProfile | null };
type FeedItem = { id: number; tone: "normal" | "success" | "warning" | "error"; text: string };

function taskFromCheckpoint(checkpoint: AgentCheckpoint): string {
  if (!checkpoint.state || typeof checkpoint.state !== "object" || Array.isArray(checkpoint.state) || !("payload" in checkpoint.state)) return "Task details unavailable";
  const payload = checkpoint.state.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("task" in payload) || typeof payload.task !== "string") return "Task details unavailable";
  return payload.task;
}

function savedOutputFromCheckpoint(checkpoint: AgentCheckpoint): string | null {
  if (!checkpoint.state || typeof checkpoint.state !== "object" || Array.isArray(checkpoint.state) || !("payload" in checkpoint.state)) return null;
  const payload = checkpoint.state.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("preview" in payload) || typeof payload.preview !== "string") return null;
  return payload.preview;
}

function statusLabel(status: AgentCheckpoint["status"]): string {
  const labels: Record<AgentCheckpoint["status"], string> = {
    running: "Running",
    waiting_for_approval: "Waiting for approval",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled"
  };
  return labels[status];
}

export function AgentControlCenter({ onClose, providerSettings, hasProviderKey, projectId, initialTask, conversationId, conversationIds = [], agentRuns }: { onClose: () => void; providerSettings: ProviderSettings; hasProviderKey: boolean; projectId?: string; initialTask?: string; conversationId?: string; conversationIds?: string[]; agentRuns?: AgentRunManager }) {
  const localRunManager = useMemo(() => new AgentRunManager(), []);
  const managedRuns = agentRuns ?? localRunManager;
  const [managedRunSnapshot, setManagedRunSnapshot] = useState(() => managedRuns.list());
  const threads = useMemo(() => agentThreads(conversationId), [conversationId]);
  const runtimeState = useMemo<RuntimeState>(() => {
    try {
      const loadedProfile = loadAgentProfile(window.localStorage);
      if (!loadedProfile.ok) throw new Error(loadedProfile.error.message);
      const saved = loadProviderProfiles(window.localStorage);
      const records = saved.ok ? saved.value : [];
      const sameSettings = (left: ProviderSettings, right: ProviderSettings) =>
        left.baseUrl === right.baseUrl && left.model === right.model &&
        left.inferenceLocation === right.inferenceLocation &&
        (left.credentialHandle ?? "default") === (right.credentialHandle ?? "default") &&
        (left.providerProtocol ?? "openai-chat-completions") === (right.providerProtocol ?? "openai-chat-completions");
      const activeProfile = records.find(profile => sameSettings(profile.settings, providerSettings));
      const profiles = records.map(profile => ({ id: profile.id, settings: profile.settings }));
      if (!activeProfile) profiles.unshift({ id: "nexus.current", settings: providerSettings });
      const models = (canUseAgentProvider(providerSettings, hasProviderKey)
        ? createTauriAutoModelRouterForProfiles(
            profiles,
            activeProfile?.id ?? "nexus.current",
            providerSettings.routeMode === "manual" ? "manual" : "auto",
            providerSettings.inferenceLocation
          )
        : null) ?? new ModelRouter();
      const registeredTestProvider = models.register(workspaceTestProvider);
      if (!registeredTestProvider.ok) throw new Error(registeredTestProvider.error.message);
      const runtime = createWorkspaceNexusRuntime("local-user", {
        authorizeAgent: async ({ agentId }) => agentId === BUILT_IN_AGENT_IDS.localWorkflow ? "ask_user" : agentId === TOOL_INVOCATION_AGENT_ID ? "allow" : "deny",
        authorizeTool: async ({ scope, resource, reason }) => {
          if (scope === "mcp:execute") {
            return window.confirm(`Allow execution of this MCP tool?\n\n${resource}\n\nThe connected server is external and may process the supplied input.`) ? "allow" : "deny";
          }
          if (scope === "filesystem:read:selected" || scope === "filesystem:write:selected") {
            const toolId = reason.match(/Tool "([^"]+)"/)?.[1] ?? "";
            const actions: Record<string, string> = {
              "workspace.list": "list entries in this folder",
              "workspace.search": "search file and folder names",
              "workspace.search_content": "search text inside approved files",
              "workspace.read": "read this file",
              "workspace.write": "create a new file",
              "workspace.mkdir": "create a new folder",
              "workspace.rename": "rename this entry",
              "workspace.move": "move this entry"
            };
            const action = actions[toolId] ?? (scope === "filesystem:read:selected" ? "read this workspace location" : "change this workspace entry");
            const readNotes: Record<string, string> = {
              "workspace.list": "Only directory entries inside the approved folder are listed.",
              "workspace.search": "Only names inside the approved folder are searched.",
              "workspace.search_content": "Text content is read only from supported regular files inside the approved folder.",
              "workspace.read": "Only the selected regular text file is read."
            };
            const reviewNote = scope === "filesystem:read:selected"
              ? readNotes[toolId] ?? "The agent will only read inside the approved workspace."
              : toolId === "workspace.write"
                ? "The file is created only when the destination does not already exist. Review the content preview."
                : "The operation is limited to the approved workspace and will not replace an existing destination.";
            return window.confirm(`Allow the NEXUS agent to ${action}?\n\n${resource}\n\n${reviewNote}\nAccess remains limited to directories you explicitly approved in File System.`) ? "allow" : "deny";
          }
          return "deny";
        }
      }, models);
      const registered = registerBuiltInAgentSuite(runtime, loadedProfile.value);
      if (!registered.ok) throw new Error(registered.error.message);
      const workspaceTools = registerWorkspaceTools(runtime.toolRegistry);
      if (!workspaceTools.ok) throw new Error(workspaceTools.error.message);
      return { runtime, error: "", profile: loadedProfile.value };
    } catch (cause) {
      return { runtime: null, error: cause instanceof Error ? cause.message : "Could not initialize the local agent runtime.", profile: null };
    }
  }, [hasProviderKey, providerSettings.baseUrl, providerSettings.model, providerSettings.credentialHandle, providerSettings.inferenceLocation, providerSettings.providerProtocol, providerSettings.routeMode]);
  const memoryRepository = useMemo(() => isTauri()
    ? new WorkspaceMemoryRepository(window.localStorage)
    : new LocalStorageMemoryRepository(window.localStorage), []);
  const memoryRetriever = useMemo(() => new HybridMemoryRetriever(
    memoryRepository,
    new LocalTransformerEmbeddingProvider(),
    new IndexedDbMemoryVectorIndex()
  ), [memoryRepository]);
  const [agentView, setAgentView] = useState<"run" | "profile" | "progress" | "approvals" | "history" | "audit">("run");
  const [task, setTask] = useState(initialTask ?? "");
  useEffect(() => {
    if (initialTask?.trim()) setTask(initialTask.slice(0, 6000));
  }, [initialTask]);
  const [profile, setProfile] = useState<AgentProfile>(runtimeState.profile ?? DEFAULT_AGENT_PROFILE);
  const [checkpointsByConversation, setCheckpointsByConversation] = useState<Record<string, AgentCheckpoint[]>>({});
  const [auditEventsByConversation, setAuditEventsByConversation] = useState<Record<string, ToolAuditEvent[]>>({});
  const [traceEventsByConversation, setTraceEventsByConversation] = useState<Record<string, TraceEvent[]>>({});
  const [auditRunByConversation, setAuditRunByConversation] = useState<Record<string, string | null>>({});
  const [historyLimitByConversation, setHistoryLimitByConversation] = useState<Record<string, number>>({});
  const [historyQueryByConversation, setHistoryQueryByConversation] = useState<Record<string, string>>({});
  const [historyStatusByConversation, setHistoryStatusByConversation] = useState<Record<string, string>>({});
  const [historyTruncatedByConversation, setHistoryTruncatedByConversation] = useState<Record<string, boolean>>({});
  const [ambiguousByConversation, setAmbiguousByConversation] = useState<Record<string, AmbiguousToolStep[]>>({});
  const [feedByConversation, setFeedByConversation] = useState<Record<string, FeedItem[]>>({});
  const conversationKey = conversationId ?? "standalone";
  const activeManagedRun = managedRunSnapshot.find(run => run.conversationId === conversationKey && run.status === "running") ?? null;
  const checkpoints = checkpointsByConversation[conversationKey] ?? [];
  const auditRunFilter = auditRunByConversation[conversationKey] ?? null;
  const auditEvents = auditEventsByConversation[conversationKey] ?? [];
  const traceEvents = traceEventsByConversation[conversationKey] ?? [];
  const historyLimit = historyLimitByConversation[conversationKey] ?? 50;
  const historyQuery = historyQueryByConversation[conversationKey] ?? "";
  const historyStatus = historyStatusByConversation[conversationKey] ?? "all";
  const ambiguousToolSteps = ambiguousByConversation[conversationKey] ?? [];
  const feed = feedByConversation[conversationKey] ?? [];
  const [busy, setBusy] = useState(false);
  const operationBusy = busy || !!activeManagedRun;
  const [activeRunIds, setActiveRunIds] = useState<Record<string, string | null>>({});
  const activeManagerRequest = useRef<string | null>(null);
  const activeRunId = activeRunIds[conversationKey] ?? null;
  const effectiveActiveRunId = activeRunId ?? activeManagedRun?.runtimeRunId ?? null;
  const filteredHistory = checkpoints.filter(checkpoint => {
    const label = checkpoint.status === "running" && checkpoint.runId !== effectiveActiveRunId ? "interrupted" : checkpoint.status;
    return (historyStatus === "all" || label === historyStatus) &&
      (!historyQuery.trim() || [checkpoint.runId, checkpoint.agentId, taskFromCheckpoint(checkpoint)]
        .join(" ").toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase()));
  });
  const visibleHistory = filteredHistory.slice(0, historyLimit);
  const setActiveRunId = (id: string | null) => setActiveRunIds(previous => ({ ...previous, [conversationKey]: id }));
  const feedSequence = useRef(0);
  const runtime = runtimeState.runtime;
  const routedModelId = providerSettings.model.trim() || (providerSettings.routeMode === "manual" ? "" : "auto");
  const agentProviderReady = canUseAgentProvider(providerSettings, hasProviderKey) && !!routedModelId;
  const plannedWorkflow = useMemo(() => runtime?.createAgentWorkflow(NATIVE_MODEL_PROVIDER_ID, routedModelId, threads.planned, ["workspace.list", "workspace.search", "workspace.search_content", "workspace.read", "workspace.write", "workspace.mkdir", "workspace.rename", "workspace.move", "mcp.*"]) ?? null, [runtime, routedModelId, threads]);
  const testWorkflow = useMemo(() => runtime?.createAgentWorkflow(
    WORKSPACE_TEST_PROVIDER, WORKSPACE_TEST_MODEL, threads.test, WORKSPACE_TEST_TOOLS
  ) ?? null, [runtime, threads]);
  const registeredAgents = runtime?.agentRuntime.list() ?? [];
  const runningCount = checkpoints.filter(item => item.status === "running" && item.runId === effectiveActiveRunId).length;
  const pendingApprovalCount = checkpoints.filter(item => item.status === "waiting_for_approval").length;
  const completedCount = checkpoints.filter(item => item.status === "completed").length;
  const failedCount = checkpoints.filter(item => item.status === "failed" || item.status === "cancelled").length;

  const addFeed = useCallback((text: string, tone: FeedItem["tone"] = "normal") => {
    feedSequence.current += 1;
    const item: FeedItem = { id: feedSequence.current, text, tone };
    setFeedByConversation(current => ({
      ...current,
      [conversationKey]: [...(current[conversationKey] ?? []), item].slice(-80)
    }));
  }, [conversationKey]);

  function reportManagedEvent(runId: string, kind: ManagedRunEvent["kind"], text: string, _tone: FeedItem["tone"] = "normal") {
    // Subscribed panels receive every event, including after closing/reopening.
    managedRuns.appendEvent(runId, kind, text);
  }

  const addFeedLatest = useRef(addFeed);
  addFeedLatest.current = addFeed;

  useEffect(() => managedRuns.subscribe(runs => setManagedRunSnapshot([...runs])), [managedRuns]);
  useEffect(() => {
    const recent = managedRuns.conversationTimeline(conversationKey).slice(-80);
    if (recent.length) {
      setFeedByConversation(current => {
        if (current[conversationKey]?.length) return current;
        return { ...current, [conversationKey]: recent.map((event, index) => ({
          id: index - recent.length,
          text: event.message,
          tone: event.kind === "error" ? "error" : event.kind === "approval" ? "warning" : event.kind === "output" ? "success" : "normal"
        })) };
      });
    }
    return managedRuns.subscribeEvents(event => {
      if (event.conversationId !== conversationKey) return;
      const tone: FeedItem["tone"] = event.kind === "error" ? "error" : event.kind === "approval" ? "warning" : event.kind === "output" ? "success" : "normal";
      addFeedLatest.current(event.message, tone);
    });
  }, [managedRuns, conversationKey]);

  const refresh = useCallback(async () => {
    if (!runtime) return;
    const [result, audit, traces] = await Promise.all([
      Promise.all([threads.primary, threads.planned, threads.test].map(thread => runtime.checkpointService.listByThread(thread, 200))),
      runtime.auditSink.list({ ...(auditRunFilter ? { runId: auditRunFilter } : {}), limit: 100 }),
      auditRunFilter ? runtime.traceSink.list({ runId: auditRunFilter, limit: 100 }) : Promise.resolve(null)
    ]);
    const failedResult = result.find(item => !item.ok);
    if (!failedResult) {
      const checkpoints = result.flatMap(item => item.ok ? item.value : []).sort((a, b) => b.updatedAt - a.updatedAt);
      managedRuns.restoreCheckpoints(conversationKey, checkpoints);
      setCheckpointsByConversation(previous => ({ ...previous, [conversationKey]: checkpoints }));
      setHistoryTruncatedByConversation(previous => ({ ...previous, [conversationKey]: result.some(item => item.ok && item.value.length === 200) }));
      const reviewableRuns = checkpoints.filter(item => item.status === "failed" || item.status === "cancelled" ||
        (item.status === "running" && item.runId !== effectiveActiveRunId)).slice(0, 50);
      const reconciliationResults = await Promise.all(reviewableRuns.map(item =>
        runtime.toolReconciliationService.listAmbiguous(item.runId, item.status === "running")
      ));
      setAmbiguousByConversation(previous => ({ ...previous, [conversationKey]: reconciliationResults.flatMap(item => item.ok ? item.value : []) }));
    } else if (!failedResult.ok) addFeed(failedResult.error.message, "error");
    if (audit.ok && !failedResult) {
      const runIds = new Set(result.flatMap(item => item.ok ? item.value.map(checkpoint => checkpoint.runId) : []));
      const scoped = audit.value.filter(item => auditRunFilter ? item.runId === auditRunFilter : runIds.has(item.runId));
      setAuditEventsByConversation(previous => ({ ...previous, [conversationKey]: scoped }));
    } else if (!audit.ok) addFeed(audit.error.message, "error");
    if (traces?.ok) setTraceEventsByConversation(previous => ({ ...previous, [conversationKey]: traces.value }));
    else if (traces && !traces.ok) addFeed(traces.error.message, "error");
  }, [runtime, addFeed, threads, conversationKey, auditRunFilter, managedRuns, effectiveActiveRunId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!runtime) return;
    const controller = new AbortController();
    const announce = (message: string, tone: FeedItem["tone"] = "normal") => addFeedLatest.current(message, tone);
    void (async () => {
      const saved = loadMcpServerConfigs(window.localStorage);
      if (!saved.ok) { announce(saved.error.message, "error"); return; }
      for (const server of saved.value) {
        if (controller.signal.aborted) break;
        const connected = await runtime.connectMcpHttp({ ...server, version: "1" }, controller.signal);
        if (!connected.ok) { announce(`MCP ${server.name}: ${connected.error.message}`, "warning"); continue; }
        if (controller.signal.aborted) { await runtime.mcpClient.disconnect(server.id); break; }
        const imported = await runtime.discoverAndImportMcpTools(server.id, controller.signal, {
          permissions: ["mcp:execute"], risk: "high", timeoutMs: 30_000
        });
        if (!imported.ok) announce(`MCP ${server.name}: ${imported.error.message}`, "warning");
        else announce(`MCP ${server.name}: discovered ${imported.value.discovered}, imported ${imported.value.imported.length}, rejected ${imported.value.rejected.length} tool(s).`, "success");
      }
    })();
    return () => {
      controller.abort();
      void Promise.all(runtime.mcpClient.listServers().map(server => runtime.mcpClient.disconnect(server.id)));
    };
  }, [runtime]);
  // The manager outlives this panel. Closing or switching conversations must
  // not cancel live work: only the explicit Cancel action aborts a run.

  async function consume(events: AsyncIterable<ResumableAgentEvent>, managerId: string, allowApprovalHandoff = false): Promise<void | "waiting_for_approval" | "failed"> {
    let outcome: void | "waiting_for_approval" | "failed" = undefined;
    for await (const event of events) {
      managedRuns.linkRuntimeRun(managerId, event.runId, allowApprovalHandoff);
      if (runtime) {
        const status = event.type === "started" ? "started" : event.type === "progress" || event.type === "output" ? "progress" : event.type === "waiting_for_approval" ? "waiting_for_approval" : event.type === "completed" ? "completed" : "failed";
        await runtime.traceSink.append({ traceId: event.runId, runId: event.runId, name: "agent.run", status, timestamp: Date.now(), ...(event.type === "completed" ? { durationMs: 0 } : {}), attributes: { event: event.type } });
      }
      if (event.type === "started") {
        setActiveRunId(event.runId);
        reportManagedEvent(managerId, "progress", "Agent run started: " + event.runId);
      } else if (event.type === "progress") {
        reportManagedEvent(managerId, "progress", "Step " + event.step + "/" + event.maxSteps + ": " + event.label);
      } else if (event.type === "output") {
        reportManagedEvent(managerId, "output", event.content, "success");
      } else if (event.type === "waiting_for_approval") {
        outcome = "waiting_for_approval";
        reportManagedEvent(managerId, "approval", "Approval required: " + event.permission, "warning");
      } else if (event.type === "completed") {
        managedRuns.resolveWaiting(event.runId, "completed");
        outcome = undefined;
        reportManagedEvent(managerId, "output", "Run completed in " + event.steps + " step(s).", "success");
      } else if (event.type === "failed") {
        outcome = "failed";
        reportManagedEvent(managerId, "error", event.message, "error");
      }
    }
    return outcome;
  }

  async function runManagedAction(action: (signal: AbortSignal, managerId: string) => Promise<void | "waiting_for_approval" | "failed">) {
    if (!runtime || busy || managedRuns.activeRun(conversationKey)) return;
    const managerId = crypto.randomUUID();
    activeManagerRequest.current = managerId;
    setBusy(true);
    try {
      await managedRuns.start(managerId, conversationKey, async signal => {
        try {
          return await action(signal, managerId);
        } catch (cause) {
          reportManagedEvent(managerId, "error", cause instanceof Error ? cause.message : "Agent execution failed.", "error");
          return "failed";
        }
      });
    } catch (cause) {
      addFeed(cause instanceof Error ? cause.message : "Could not schedule the agent run.", "error");
    } finally {
      activeManagerRequest.current = null;
      setBusy(false);
      setActiveRunId(null);
      await refresh();
    }
  }

  async function runAction(action: (signal: AbortSignal) => AsyncIterable<ResumableAgentEvent>, allowApprovalHandoff = false) {
    await runManagedAction((signal, managerId) => consume(action(signal), managerId, allowApprovalHandoff));
  }

  function inspectRunAudit(runId: string) {
    setAuditRunByConversation(previous => ({ ...previous, [conversationKey]: runId }));
    setAgentView("audit");
  }

  function showRecentAudit() {
    setAuditRunByConversation(previous => ({ ...previous, [conversationKey]: null }));
  }

  function loadMoreHistory() {
    setHistoryLimitByConversation(previous => ({ ...previous, [conversationKey]: (previous[conversationKey] ?? 50) + 50 }));
  }

  function cancelActiveRun() {
    if (!managedRuns.cancelConversation(conversationKey)) addFeed("No active run to cancel.", "warning");
  }

  async function saveProfile() {
    if (!runtime || operationBusy) return;
    setBusy(true);
    const ids = new Set([agentThreads().primary, threads.primary, ...conversationIds.map(id => agentThreads(id).primary)]);
    let listed: Awaited<ReturnType<typeof runtime.checkpointService.listByThread>>[];
    try {
      listed = await Promise.all([...ids].map(id => runtime.checkpointService.listByThread(id, 200)));
    } catch {
      setBusy(false);
      addFeed("Could not verify pending runs; agent profile was not changed.", "error");
      return;
    }
    setBusy(false);
    if (listed.some(item => !item.ok || item.value.length === 200)) {
      addFeed("Could not verify all pending runs; agent profile was not changed.", "error");
      return;
    }
    if (listed.some(item => item.ok && item.value.some(checkpoint => checkpoint.status === "running" || checkpoint.status === "waiting_for_approval"))) {
      addFeed("Finish or reject active runs in every conversation before changing the agent version.", "warning");
      return;
    }
    const next: AgentProfile = { ...profile, name: profile.name.trim(), revision: profile.revision + 1, updatedAt: Date.now() };
    const validation = validateAgentProfile(next);
    if (validation) { addFeed(validation, "error"); return; }
    const replaced = runtime.agentRuntime.replace(createLocalWorkflowDefinition(next));
    if (!replaced.ok) { addFeed(replaced.error.message, "error"); return; }
    const saved = saveAgentProfile(window.localStorage, next);
    if (!saved.ok) {
      runtime.agentRuntime.replace(createLocalWorkflowDefinition(profile));
      addFeed(saved.error.message, "error");
      return;
    }
    setProfile(next);
    addFeed("Agent profile saved as version 1." + next.revision + ".0.", "success");
  }

  async function startPlannedWorkflow(useTestProvider = false) {
    const workflow = useTestProvider ? testWorkflow : plannedWorkflow;
    if (!runtime || !workflow || !task.trim() || operationBusy) return;
    const goal = task.trim();
    const projectDisclosure = projectId ? " and relevant knowledge from the selected project" : "";
    if (!useTestProvider && !window.confirm(`Send this task, saved profile memories${projectDisclosure} to your configured AI provider? The planner may use approved workspace tools and MCP servers you explicitly connected. Each file operation and each MCP tool call requires a separate confirmation. External MCP servers may process the approved input.`)) return;
    setTask("");
    setFeedByConversation(current => ({ ...current, [conversationKey]: [] }));
    await runManagedAction(async (signal, managerId) => {
      let referenceContext: string | undefined;
      if (useTestProvider) {
        reportManagedEvent(managerId, "progress", "Test planner · offline read-only inspection");
      } else {
        reportManagedEvent(managerId, "progress", "Retrieving relevant saved profile and project context…");
        const contextWarnings: string[] = [];
        const memories = await memoryRetriever.search(goal, "profile", 4, signal);
        const contextParts = memories.ok ? memories.value.map(item => `[Profile memory: ${item.record.category}; source: ${item.record.source.label}] ${item.record.content}`) : [];
        if (!memories.ok) contextWarnings.push("Profile memory unavailable: " + memories.error.message);
        if (projectId) {
          const [knowledge, projectMemories] = await Promise.all([
            runtime.knowledgeService.retrieve(goal, projectId, 4, signal),
            memoryRetriever.search(goal, "project", 3, signal, projectId)
          ]);
          if (!knowledge.ok) contextWarnings.push("Project knowledge unavailable: " + knowledge.error.message);
          else if (knowledge.value.context) contextParts.push("Selected project knowledge (source-grounded reference data):\n" + knowledge.value.context);
          if (!projectMemories.ok) contextWarnings.push("Project memory unavailable: " + projectMemories.error.message);
          else contextParts.push(...projectMemories.value.map(item => `[Project memory: ${item.record.category}; source: ${item.record.source.label}] ${item.record.content}`));
        }
        if (contextWarnings.length) reportManagedEvent(managerId, "progress", "Continuing without some saved context. " + contextWarnings.join(" "), "warning");
        referenceContext = contextParts.join("\n\n").slice(0, 12_000);
        reportManagedEvent(managerId, "progress", "Sending the task and approved reference context to the configured model planner…");
      }
      const result = await workflow.plan(goal, signal, referenceContext);
      if (!result.ok) {
        reportManagedEvent(managerId, "error", "Planning failed: " + result.error.message, "error");
        return "failed";
      }
      reportManagedEvent(managerId, "progress", "Validated plan: " + result.value.steps.length + " bounded tool step(s).", "success");
      const coordinationId = crypto.randomUUID() as AgentRunId;
      managedRuns.linkRuntimeRun(managerId, coordinationId);
      setActiveRunId(coordinationId);
      let outcome: void | "waiting_for_approval" | "failed" = undefined;
      for await (const event of workflow.run(result.value, coordinationId, signal)) {
        if (event.type === "started") reportManagedEvent(managerId, "progress", "Planned workflow started: " + event.runId);
        else if (event.type === "agent_started") reportManagedEvent(managerId, "progress", "Executing step " + event.step + " with " + event.agentId + "…");
        else if (event.type === "agent_completed") reportManagedEvent(managerId, "output", "Step " + event.step + " completed.\n" + (event.detail ?? "No output returned."), "success");
        else if (event.type === "waiting_for_approval") {
          outcome = "waiting_for_approval";
          reportManagedEvent(managerId, "approval", "Approval required for step " + event.step + ".", "warning");
        } else if (event.type === "completed") {
          outcome = undefined;
          reportManagedEvent(managerId, "output", event.detail ?? "Planned workflow completed.", "success");
        } else if (event.type === "failed") {
          outcome = "failed";
          reportManagedEvent(managerId, "error", event.detail ?? "Planned workflow failed.", "error");
        }
      }
      return outcome;
    });
  }

  function startAgent() {
    if (!runtime || operationBusy || !task.trim() || task.trim().length > 1_000) return;
    const input = task.trim();
    setTask("");
    setFeedByConversation(current => ({ ...current, [conversationKey]: [] }));
    void runAction(signal => runtime.agentRuntime.start(BUILT_IN_AGENT_IDS.localWorkflow, input, threads.primary, signal));
  }

  function approve(checkpoint: AgentCheckpoint) {
    if (!runtime) return;
    void runAction(async function* (signal: AbortSignal) {
      const grant = await runtime.issueApproval(checkpoint.runId as AgentRunId);
      if (!grant.ok) {
        yield { type: "failed", runId: checkpoint.runId as AgentRunId, message: grant.error.message } as ResumableAgentEvent;
        return;
      }
      yield* runtime.agentRuntime.resume(checkpoint.runId as AgentRunId, grant.value, signal);
    }, true);
  }

  function continueInterrupted(checkpoint: AgentCheckpoint) {
    if (!runtime || busy || managedRuns.activeRun(conversationKey)) return;
    // Planned workflows require a coordinator plan that this view cannot
    // reconstruct. Limit manual recovery to the registered local workflow.
    if (checkpoint.status !== "running" || checkpoint.threadId !== threads.primary ||
        checkpoint.agentId !== BUILT_IN_AGENT_IDS.localWorkflow || checkpoint.runId === activeRunId) return;
    if (!window.confirm(
      "Manually continue this interrupted local agent from its last saved step? " +
      "NEXUS will verify durable tool history, request fresh permissions, " +
      "and stop instead of replaying a tool with an uncertain outcome."
    )) return;
    void runAction(signal => runtime.agentRuntime.continue(checkpoint.runId as AgentRunId, signal), true);
  }

  async function reject(checkpoint: AgentCheckpoint) {
    if (!runtime || checkpoint.status !== "waiting_for_approval") return;
    const rejected: AgentCheckpoint = {
      ...checkpoint,
      sequence: checkpoint.sequence + 1,
      status: "failed",
      updatedAt: Date.now()
    };
    delete rejected.pendingApproval;
    const result = await runtime.checkpointService.persist(rejected);
    if (!result.ok) addFeed(result.error.message, "error");
    else {
      managedRuns.resolveWaiting(checkpoint.runId, "failed");
      addFeed("Approval rejected. The run was closed without executing the tool.", "warning");
    }
    await refresh();
  }

  async function reconcileToolStep(step: AmbiguousToolStep) {
    if (!runtime || busy) return;
    const confirmed = window.confirm(
      "This tool step may have timed out or been cancelled after its external operation began. Verify in the external system whether it completed or is still running. Marking it reconciled only blocks retries; it does not stop an operation already in progress. Continue?"
    );
    if (!confirmed) return;
    const interrupted = checkpoints.some(item => item.runId === step.runId && item.status === "running" && item.runId !== effectiveActiveRunId);
    const result = await runtime.toolReconciliationService.reconcile(
      step.runId, step.toolId, step.traceId, true, interrupted
    );
    if (!result.ok) addFeed(result.error.message, "error");
    else addFeed(`Manually reconciled ${step.toolId}. No tool was rerun.`, "success");
    await refresh();
  }

  return <div className="agent-backdrop" role="dialog" aria-modal="true" aria-labelledby="agent-center-title">
    <section className="agent-center">
      <header className="agent-center-header">
        <div className="agent-center-title">
          <div className="agent-center-icon"><Bot size={20}/></div>
          <div><div className="eyebrow">{t("NEXUS AU / CONTROL PLANE")}</div><h2 id="agent-center-title">{t("Agent Control Center")}</h2><p>{t("Bounded execution, explicit approvals, checkpoints and audit.")}</p></div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close agent control center"><X size={18}/></button>
      </header>

      {runtimeState.error && <div className="agent-error"><AlertTriangle size={16}/>{t(runtimeState.error)}</div>}

      <section className="agent-runtime-strip" aria-label="Agent runtime overview">
        <article><span className="agent-runtime-mark"/><div><strong>{registeredAgents.length}</strong><small>{t("Registered agents")}</small></div></article>
        <article data-state="running"><span className="agent-runtime-mark"/><div><strong>{runningCount}</strong><small>{t("Running")}</small></div></article>
        <article data-state="approval"><span className="agent-runtime-mark"/><div><strong>{pendingApprovalCount}</strong><small>{t("Awaiting approval")}</small></div></article>
        <article data-state="completed"><span className="agent-runtime-mark"/><div><strong>{completedCount}</strong><small>{t("Completed")}</small></div></article>
        <article data-state="failed"><span className="agent-runtime-mark"/><div><strong>{failedCount}</strong><small>{t("Failed / cancelled")}</small></div></article>
      </section>

      <nav className="workspace-view-tabs" aria-label={t("Agent sections")}>
        {([ ["run", "Task"], ["profile", "Profile settings"], ["progress", "Run event stream"], ["approvals", "Approvals"], ["history", "Run history"], ["audit", "Audit"] ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={agentView === id} onClick={() => setAgentView(id)}>{t(label)}{id === "approvals" && pendingApprovalCount > 0 ? ` (${pendingApprovalCount})` : ""}</button>)}
      </nav>
      <div className="agent-center-grid">
        <section className="agent-main-column" hidden={!(["run", "profile", "progress"] as const).some(view => view === agentView)}>
          <article className="agent-card" hidden={agentView !== "run"}>
            <div className="agent-card-heading"><div><span className="agent-kicker">AVAILABLE AGENTS · {registeredAgents.length}</span><h3>{registeredAgents[0]?.name ?? BUILT_IN_AGENT_CATALOG[0].name}</h3></div><span className="agent-local-tag">{t("LOCAL DEMO")}</span></div>
            <p>{registeredAgents[0]?.description ?? BUILT_IN_AGENT_CATALOG[0].description}</p>
            <div className="agent-metadata">
              <span><Activity size={13}/> {registeredAgents[0]?.maxSteps ?? 3} max steps</span>
              <span><Clock3 size={13}/> {Math.round((registeredAgents[0]?.timeoutMs ?? 15_000) / 1_000)} sec limit</span>
              <span><Shield size={13}/> {(registeredAgents[0]?.requiredPermissions ?? []).join(", ") || "No permissions"}</span>
            </div>
            <label className="agent-task-label" htmlFor="agent-task">{t("Task input")}</label>
            <textarea id="agent-task" value={task} onChange={event => setTask(event.target.value)} maxLength={1_000} rows={3} placeholder="Describe a task for the local workflow preview…"/>
            <div className="agent-form-footer"><span>{task.length}/1000 characters</span><div className="agent-run-actions"><button className="agent-primary-button" disabled={!runtime || operationBusy || !task.trim()} onClick={startAgent}><Play size={14}/> Run demo</button><button className="agent-small-button" disabled={!testWorkflow || !isTauri() || operationBusy || !task.trim()} onClick={() => void startPlannedWorkflow(true)} title='Use list <absolute path>, read <absolute path>, or search {"path":"...","query":"..."}'>Test planner (offline)</button><button className="agent-small-button" disabled={!agentProviderReady || !plannedWorkflow || operationBusy || !task.trim()} onClick={() => void startPlannedWorkflow()} title={plannedWorkflow && agentProviderReady ? "Create a model plan and execute registered tools through the permission-gated runtime" : providerSettings.credentialHandle === "none" ? "Select a model for the local provider to enable AI planning" : "Save a provider API key and select a model in Settings to enable AI planning"}><Sparkles size={14}/> Plan with AI</button></div></div>
            <div className="agent-disclaimer">The demo agent creates a local preview. The AI planner uses your configured provider and can list, read, create or edit files only inside folders you approved in File System. Each file operation requires confirmation; unapproved external tools remain blocked.</div>
          </article>

          <article className="agent-card" hidden={agentView !== "profile"}>
            <div className="agent-card-heading"><div><span className="agent-kicker">{t("AGENT CONFIGURATION")}</span><h3>{t("Profile settings")}</h3></div><span className="agent-local-tag">V1.{profile.revision}.0</span></div>
            <label className="agent-task-label" htmlFor="agent-name">{t("Display name")}</label>
            <input id="agent-name" className="agent-profile-input" value={profile.name} maxLength={80} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))}/>
            <div className="agent-profile-fields">
              <label>{t("Maximum steps")}<input type="number" min={1} max={20} value={profile.maxSteps} onChange={event => setProfile(current => ({ ...current, maxSteps: Number(event.target.value) }))}/></label>
              <label>{t("Timeout (seconds)")}<input type="number" min={1} max={60} value={Math.round(profile.timeoutMs / 1_000)} onChange={event => setProfile(current => ({ ...current, timeoutMs: Number(event.target.value) * 1_000 }))}/></label>
            </div>
            <div className="agent-form-footer"><span>{t("Permission requirement stays fixed: tool:execute")}</span><button className="agent-small-button" disabled={!runtime || busy || !profile.name.trim() || profile.maxSteps < 1 || profile.maxSteps > 20 || profile.timeoutMs < 1_000 || profile.timeoutMs > 60_000} onClick={() => void saveProfile()}>{t("Save profile")}</button></div>
            <div className="agent-disclaimer">Changing the profile creates a new agent version. Finish or reject active runs first; older checkpoints cannot resume on a different version.</div>
          </article>

          <article className="agent-card" hidden={agentView !== "progress"}>
            <div className="agent-card-heading"><div><span className="agent-kicker">{t("LIVE EXECUTION")}</span><h3>{t("Run event stream")}</h3></div><button className="agent-small-button" onClick={() => void refresh()} disabled={!runtime}><RefreshCw size={13}/> Refresh</button></div>
            {feed.length === 0 ? <div className="agent-empty">{t("Start a run to inspect progress, approval handoffs and output.")}</div> : <div className="agent-feed">{feed.map(item => <div className={"agent-feed-item " + item.tone} key={item.id}><span className="agent-feed-dot"/><pre>{t(item.text)}</pre></div>)}</div>}
            {activeManagedRun && <button className="agent-danger-button" onClick={cancelActiveRun}><X size={13}/> Cancel active run</button>}
            {activeRunId && <span className="agent-active-id">Active run: {activeRunId}</span>}
          </article>
        </section>

        <aside className="agent-side-column" hidden={agentView === "run" || agentView === "profile" || agentView === "progress"}>
          <article className="agent-card agent-approval-card" hidden={agentView !== "approvals"}>
            <div className="agent-card-heading"><div><span className="agent-kicker">{t("HUMAN IN THE LOOP")}</span><h3>{t("Approval queue")}</h3></div><span className="agent-count">{checkpoints.filter(item => item.status === "waiting_for_approval").length}</span></div>
            {checkpoints.filter(item => item.status === "waiting_for_approval").length === 0 ? <div className="agent-empty">{t("No pending approvals.")}</div> :
              checkpoints.filter(item => item.status === "waiting_for_approval").map(checkpoint => <div className="agent-approval-item" key={checkpoint.runId}>
                <strong>{checkpoint.pendingApproval?.permission}</strong><p>{taskFromCheckpoint(checkpoint)}</p><small>Run {checkpoint.runId}</small>
                <div className="agent-approval-actions"><button onClick={() => approve(checkpoint)} disabled={busy}><Check size={13}/> Approve once</button><button onClick={() => void reject(checkpoint)} disabled={busy}>{t("Reject")}</button></div>
              </div>)}
          </article>

          <article className="agent-card" hidden={agentView !== "history"}>
            <div className="agent-card-heading"><div><span className="agent-kicker">{t("PERSISTED CHECKPOINTS")}</span><h3>{t("Run history")}</h3></div><span className="agent-count">{checkpoints.length}</span></div>
            <div className="agent-profile-fields">
              <label>Search saved runs<input aria-label="Search saved runs" className="agent-profile-input" type="search"
                value={historyQuery} onChange={event => setHistoryQueryByConversation(current => ({ ...current, [conversationKey]: event.target.value }))}
                placeholder="Task or run ID"/></label>
              <label>Status<select aria-label="Filter runs by status" className="agent-profile-input"
                value={historyStatus} onChange={event => setHistoryStatusByConversation(current => ({ ...current, [conversationKey]: event.target.value }))}>
                  <option value="all">All statuses</option><option value="running">Running</option>
                  <option value="interrupted">Interrupted</option><option value="waiting_for_approval">Waiting for approval</option>
                  <option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option>
                </select></label>
            </div>
            {checkpoints.length === 0 ? <div className="agent-empty">{t("No saved runs yet.")}</div> :
              filteredHistory.length === 0 ? <div className="agent-empty">No saved runs match your filters.</div> :
              <div className="agent-history">{visibleHistory.map(checkpoint => <div className="agent-history-item" key={checkpoint.runId}>
                <div className="agent-history-top"><span className={"agent-status " + checkpoint.status}>{checkpoint.status === "running" && checkpoint.runId !== effectiveActiveRunId ? "Interrupted" : statusLabel(checkpoint.status)}</span><time>{new Date(checkpoint.updatedAt).toLocaleString()}</time></div>
                <p>{taskFromCheckpoint(checkpoint)}</p><small>{checkpoint.runId} · checkpoint #{checkpoint.sequence}</small>
                <div className="agent-approval-actions"><button className="agent-small-button" type="button" disabled={!runtime} onClick={() => inspectRunAudit(checkpoint.runId)}>Inspect audit</button></div>
                {savedOutputFromCheckpoint(checkpoint) && <details className="agent-saved-output"><summary>{t("View saved result")}</summary><pre>{savedOutputFromCheckpoint(checkpoint)}</pre></details>}
                {checkpoint.status === "running" && checkpoint.runId !== effectiveActiveRunId &&
                  (checkpoint.threadId === threads.primary && checkpoint.agentId === BUILT_IN_AGENT_IDS.localWorkflow
                    ? <div className="agent-approval-actions">
                        <p>Interrupted local run. Manual recovery verifies tool history and requests new approval.</p>
                        <button className="agent-small-button" type="button"
                          disabled={!runtime || busy || !!managedRuns.activeRun(conversationKey)}
                          onClick={() => continueInterrupted(checkpoint)}>Continue safely</button>
                      </div>
                    : <p>Automatic continuation is disabled for this workflow. Start a new task after reviewing prior tool outcomes.</p>)}
              </div>)}</div>}
            {checkpoints.length > 0 && <div className="agent-form-footer"><span>Showing {visibleHistory.length} of {filteredHistory.length} runs</span>{visibleHistory.length < filteredHistory.length && <button type="button" className="agent-small-button" onClick={loadMoreHistory}>Load more runs</button>}</div>}
            {historyTruncatedByConversation[conversationKey] && <p className="agent-disclaimer">Some threads reached the 200-run query limit. Older runs may not be included in this view.</p>}
          </article>

          <article className="agent-card" hidden={agentView !== "audit"}>
            {ambiguousToolSteps.length > 0 && <div className="agent-reconciliation">
              <div className="agent-card-heading"><div><span className="agent-kicker">{t("OWNER REVIEW REQUIRED")}</span><h3>{t("Ambiguous tool outcomes")}</h3></div><span className="agent-count">{ambiguousToolSteps.length}</span></div>
              <p>These tool steps started before a run failed, was cancelled, or was interrupted. Their outcome is uncertain. Inspect the external system before marking one reconciled. This will never retry the tool.</p>
              {ambiguousToolSteps.map(step => <div className="agent-history-item" key={step.runId + step.traceId + step.toolId}>
                <p>{step.toolId}</p><small>Run {step.runId} · Trace {step.traceId}</small>
                <button className="agent-small-button" disabled={busy} onClick={() => void reconcileToolStep(step)}>{t("Mark manually reconciled")}</button>
              </div>)}
            </div>}
            <div className="agent-card-heading"><div><span className="agent-kicker">{t("TOOL GATEWAY")}</span><h3>{t("Recent tool audit")}</h3></div><span className="agent-count">{auditEvents.length}</span></div>
            {auditRunFilter && <div className="agent-form-footer"><span>Audit for {auditRunFilter}</span><button type="button" className="agent-small-button" onClick={showRecentAudit}>Show recent audits</button></div>}
            {auditRunFilter && <section className="agent-reconciliation" aria-label="Persisted run trace">
              <div className="agent-card-heading"><div><span className="agent-kicker">DURABLE ACTIVITY</span><h3>Run trace</h3></div><span className="agent-count">{traceEvents.length}</span></div>
              {traceEvents.length === 0 ? <div className="agent-empty">No persisted trace events for this run.</div> :
                <div className="agent-history">{traceEvents.slice(-50).reverse().map((event, index) => <div className="agent-history-item" key={event.traceId + event.name + event.timestamp + index}>
                  <div className="agent-history-top"><span className={"agent-status " + event.status}>{event.status.toUpperCase()}</span><time>{new Date(event.timestamp).toLocaleString()}</time></div>
                  <p>{event.name}</p><small>{event.durationMs === undefined ? "Recorded event" : "Duration: " + event.durationMs + " ms"}</small>
                </div>)}</div>}
            </section>}
            {auditEvents.length === 0 ? <div className="agent-empty">{t("No tool executions have been recorded.")}</div> :
              <div className="agent-history">{auditEvents.slice(-50).reverse().map((event, index) => <div className="agent-history-item" key={event.traceId + event.toolId + event.timestamp + index}>
                <div className="agent-history-top"><span className={"agent-status " + event.status}>{event.status.toUpperCase()}</span><time>{new Date(event.timestamp).toLocaleString()}</time></div>
                <p>{event.toolId}</p><small>Run {event.runId} · Trace {event.traceId}</small>
              </div>)}</div>}
            <div className="agent-disclaimer">Audit entries show tool identity and execution state. Raw tool inputs and provider credentials are not displayed here.</div>
          </article>
        </aside>
      </div>
      <footer className="agent-center-footer"><span>{isTauri() ? "Storage: native SQLite checkpoints, audit and traces" : "Storage: browser localStorage preview"} · approval grants: one-time</span><span>{t("Default-deny tool policy")}</span></footer>
    </section>
  </div>;
}
