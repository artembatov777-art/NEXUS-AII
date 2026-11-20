import { invoke } from "@tauri-apps/api/core";
import { err, ok, type Result } from "../core/result";
import {
  validActivityId, validAgentActivityEvent,
  type AgentActivityEvent, type AgentActivityRepository
} from "./agentActivity";

/** Durable SQLite journal for the Windows/macOS/Linux desktop host. */
export class NativeAgentActivityRepository implements AgentActivityRepository {
  async append(event: AgentActivityEvent): Promise<Result<void>> {
    if (!validAgentActivityEvent(event)) {
      return err("validation", "Activity event contains invalid or unsafe fields.");
    }
    try {
      await invoke("record_agent_activity_event", { event });
      return ok(undefined);
    } catch {
      return err("storage_failed", "Could not persist the native agent activity event.", true);
    }
  }

  async listByConversation(conversationId: string, limit = 100): Promise<Result<AgentActivityEvent[]>> {
    if (!validActivityId(conversationId) || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      return err("validation", "Activity conversation or limit is invalid.");
    }
    try {
      const events = await invoke<unknown>("list_agent_activity_events", { conversationId, limit });
      if (!Array.isArray(events) || events.length > limit || !events.every(item =>
        validAgentActivityEvent(item) && item.conversationId === conversationId
      )) {
        return err("storage_failed", "Native activity history returned invalid or unrelated rows.");
      }
      return ok(events.map(event => ({ ...event })));
    } catch {
      return err("storage_failed", "Could not load native agent activity history.", true);
    }
  }
}
