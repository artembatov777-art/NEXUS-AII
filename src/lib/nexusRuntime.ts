import type { AgentId, AgentPermission, AgentPermissionService, AgentRunId, AgentClock, AgentIdFactory } from "../core/agents";
import { AgentCheckpointService } from "../core/agentCheckpoints";
import { InMemoryAgentApprovalAuthority, type AgentApprovalIdFactory } from "../core/agentApprovals";
import { GatewayAgentToolExecutor } from "../core/agentToolBridge";
import { ResumableAgentRuntime } from "../core/resumableAgents";
import { err, type Result } from "../core/result";
import { ToolGateway, type PermissionRequest, type PermissionService, type ToolClock } from "../core/tools";
import { LocalStorageAgentCheckpointRepository } from "./agentCheckpointStorage";
import { LocalStorageToolAuditSink } from "./toolAuditStorage";
import type { StorageLike } from "./memoryStorage";
import { ToolRegistry } from "../core/toolRegistry";
import { McpClient } from "../core/mcpClient";
import { McpHttpTransport } from "../core/mcpHttpTransport";
import type { PermissionScope, ToolRisk } from "../core/tools";
import { AgentPlanner } from "../core/agentPlanner";
import { ModelRouterPlanner } from "../core/modelPlanner";
import { MultiAgentCoordinator } from "../core/multiAgentCoordinator";
import { ResumableAgentTaskExecutor } from "../core/resumableAgentExecutor";
import { LocalStorageTraceSink } from "./traceStorage";
import type { ModelRouter } from "../core/model";
import { MemoryService, type MemoryId } from "../core/memory";
import { HybridMemoryRetriever, KnowledgeRetrievalService } from "../core/knowledge";
import { ProjectService, type ProjectId } from "../core/projects";
import { LocalStorageMemoryRepository } from "./memoryStorage";
import { LocalStorageProjectRepository } from "./projectStorage";
import { LocalStorageKnowledgeRepository } from "./knowledgeStorage";

export interface NexusPermissionPolicy {
  authorizeAgent(input: { agentId: AgentId; permission: AgentPermission; reason: string }): Promise<"allow" | "deny" | "ask_user">;
  authorizeTool(request: PermissionRequest): Promise<"allow" | "deny" | "ask_user">;
}

export interface NexusRuntimeIds extends AgentIdFactory, AgentApprovalIdFactory {}

export interface NexusRuntimeOptions {
  storage: StorageLike;
  actorId: string;
  permissions?: NexusPermissionPolicy;
  ids?: NexusRuntimeIds;
  clock?: AgentClock & ToolClock;
  models?: ModelRouter;
}

const denyByDefault: NexusPermissionPolicy = {
  authorizeAgent: async () => "deny",
  authorizeTool: async () => "deny"
};

const systemClock: AgentClock & ToolClock = { now: () => Date.now() };

function createIds(): NexusRuntimeIds {
  const randomId = (prefix: string) => {
    if (!globalThis.crypto?.randomUUID) throw new Error("A cryptographically secure UUID source is required.");
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  };
  return {
    runId: () => randomId("run") as AgentRunId,
    approvalId: () => randomId("approval")
  };
}

class AgentPermissionAdapter implements AgentPermissionService {
  constructor(private readonly policy: NexusPermissionPolicy) {}
  authorize(input: { agentId: AgentId; permission: AgentPermission; reason: string }) {
    return this.policy.authorizeAgent(input);
  }
}

class ToolPermissionAdapter implements PermissionService {
  constructor(private readonly policy: NexusPermissionPolicy) {}
  authorize(request: PermissionRequest) {
    return this.policy.authorizeTool(request);
  }
}

/**
 * Composition root for the local preview runtime.
 *
 * Checkpoints and audit events use localStorage and are not secure against
 * same-origin script access, tampering, quota failures, or concurrent tabs.
 * Production desktop composition must replace these adapters with native,
 * access-controlled persistence before enabling sensitive tools.
 */
export function createNexusRuntime(options: NexusRuntimeOptions) {
  if (!options.actorId.trim() || options.actorId.length > 160) {
    throw new Error("A valid host actor identity is required.");
  }
  const ids = options.ids ?? createIds();
  const clock = options.clock ?? systemClock;
  const policy = options.permissions ?? denyByDefault;

  const checkpointRepository = new LocalStorageAgentCheckpointRepository(options.storage);
  const checkpointService = new AgentCheckpointService(checkpointRepository);
  const auditSink = new LocalStorageToolAuditSink(options.storage);
  const toolGateway = new ToolGateway(new ToolPermissionAdapter(policy), auditSink, clock);
  const toolRegistry = new ToolRegistry(toolGateway);
  const mcpClient = new McpClient(toolRegistry, toolGateway);
  const traceSink = new LocalStorageTraceSink(options.storage);
  const memoryRepository = new LocalStorageMemoryRepository(options.storage);
  const memoryService = new MemoryService(memoryRepository, { memoryId: () => ids.runId().replace("run_", "memory_") as MemoryId }, clock);
  const memoryRetriever = new HybridMemoryRetriever(memoryRepository);
  const projectRepository = new LocalStorageProjectRepository(options.storage);
  const projectService = new ProjectService(projectRepository, () => ids.runId().replace("run_", "project_") as ProjectId, clock.now);
  const knowledgeRepository = new LocalStorageKnowledgeRepository(options.storage);
  const knowledgeService = new KnowledgeRetrievalService(knowledgeRepository);
  const agentToolExecutor = new GatewayAgentToolExecutor(toolGateway, options.actorId);
  const approvalAuthority = new InMemoryAgentApprovalAuthority(checkpointService, ids);
  const agentRuntime = new ResumableAgentRuntime(
    checkpointService,
    new AgentPermissionAdapter(policy),
    ids,
    clock,
    agentToolExecutor,
    approvalAuthority
  );

  return {
    agentRuntime,
    toolGateway,
    toolRegistry,
    mcpClient,
    traceSink,
    connectMcpHttp: (input: { id: string; name: string; version: string; endpoint: string }, signal: AbortSignal) => mcpClient.connect({ ...input, transport: new McpHttpTransport({ endpoint: input.endpoint }) }, signal),
    discoverAndImportMcpTools: (serverId: string, signal: AbortSignal, defaults: { permissions: PermissionScope[]; risk: ToolRisk; timeoutMs: number }) => mcpClient.discoverAndImport(serverId, signal, defaults),
    createPlanner: (providerId: string, model: string) => options.models
      ? new AgentPlanner(new ModelRouterPlanner(options.models, providerId, model))
      : null,
    createCoordinator: (threadId = "nexus-multi-agent") => new MultiAgentCoordinator(
      new ResumableAgentTaskExecutor(agentRuntime, threadId),
      { authorize: async (agentId, reason) => policy.authorizeAgent({ agentId, permission: "tool:execute", reason }) },
      traceSink, clock
    ),
    checkpointService,
    checkpointRepository,
    auditSink,
    approvalAuthority,
    /** Call only in response to an explicit user approval action in the UI. */
    issueApproval: (runId: AgentRunId): Promise<Result<string>> => approvalAuthority.issue(runId)
  };
}

export function createBrowserNexusRuntime(
  actorId: string,
  permissions?: NexusPermissionPolicy,
  models?: ModelRouter
): ReturnType<typeof createNexusRuntime> {
  if (typeof window === "undefined") throw new Error("Browser storage is unavailable in this environment.");
  try {
    return createNexusRuntime({ storage: window.localStorage, actorId, permissions, models });
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    throw new Error("Could not initialize the browser runtime.");
  }
}

/** Utility for adapters that need an explicit fail-closed Result. */
export const denyNexusOperation = (message = "No permission policy was configured."): Result<never> =>
  err("permission_denied", message);
