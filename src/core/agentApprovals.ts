import { AgentCheckpointService } from "./agentCheckpoints";
import type { AgentId, AgentPermission, AgentRunId } from "./agents";
import { err, ok, type Result } from "./result";

export interface AgentApprovalIdFactory {
  approvalId(): string;
}

export interface AgentApprovalAuthority {
  consume(input: {
    approvalId: string;
    runId: AgentRunId;
    agentId: AgentId;
    permission: AgentPermission;
  }): Promise<boolean>;
}

/**
 * Host-side, one-time approval grants. Grants are intentionally ephemeral:
 * after restart the UI must ask the user again rather than replaying stale consent.
 */
export class InMemoryAgentApprovalAuthority implements AgentApprovalAuthority {
  private readonly grants = new Map<string, {
    runId: AgentRunId;
    agentId: AgentId;
    permission: AgentPermission;
  }>();

  constructor(
    private readonly checkpoints: AgentCheckpointService,
    private readonly ids: AgentApprovalIdFactory
  ) {}

  async issue(runId: AgentRunId): Promise<Result<string>> {
    const loaded = await this.checkpoints.get(runId);
    if (!loaded.ok) return loaded;
    const checkpoint = loaded.value;
    if (!checkpoint || checkpoint.status !== "waiting_for_approval" || !checkpoint.pendingApproval) {
      return err("validation", "This run is not waiting for user approval.");
    }
    const approvalId = this.ids.approvalId();
    if (!approvalId.trim() || approvalId.length > 160 || this.grants.has(approvalId)) {
      return err("validation", "Approval id is invalid or already in use.");
    }
    this.grants.set(approvalId, {
      runId,
      agentId: checkpoint.agentId as AgentId,
      permission: checkpoint.pendingApproval.permission as AgentPermission
    });
    return ok(approvalId);
  }

  async consume(input: {
    approvalId: string;
    runId: AgentRunId;
    agentId: AgentId;
    permission: AgentPermission;
  }): Promise<boolean> {
    const grant = this.grants.get(input.approvalId);
    if (!grant || grant.runId !== input.runId || grant.agentId !== input.agentId || grant.permission !== input.permission) {
      return false;
    }
    this.grants.delete(input.approvalId);
    return true;
  }
}
