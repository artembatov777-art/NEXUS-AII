import { err, ok, type Result } from "../core/result";
import { validActivityId, validAgentActivityEvent, type AgentActivityEvent, type AgentActivityRepository } from "./agentActivity";
import type { StorageLike } from "./memoryStorage";

const STORAGE_KEY = "nexus-au:agent-activity:v1";
const MAX_EVENTS = 5_000;
const MAX_BYTES = 1_000_000;

/** Browser preview fallback only. Native desktop journal uses transactional SQLite. */
export class LocalStorageAgentActivityRepository implements AgentActivityRepository {
  constructor(private readonly storage: StorageLike, private readonly key = STORAGE_KEY) {}

  async append(event: AgentActivityEvent): Promise<Result<void>> {
    if (!validAgentActivityEvent(event)) return err("validation", "Activity event contains invalid or unsafe fields.");
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    const next = [...loaded.value, { ...event }].slice(-MAX_EVENTS);
    try {
      const serialized = JSON.stringify(next);
      if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) {
        return err("storage_failed", "Agent activity history reached its storage limit.");
      }
      this.storage.setItem(this.key, serialized);
      return ok(undefined);
    } catch {
      return err("storage_failed", "Could not save agent activity.", true);
    }
  }

  async listByConversation(conversationId: string, limit = 100): Promise<Result<AgentActivityEvent[]>> {
    if (!validActivityId(conversationId) || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      return err("validation", "Activity conversation or limit is invalid.");
    }
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    return ok(loaded.value.filter(item => item.conversationId === conversationId)
      .slice(-limit).map(item => ({ ...item })));
  }

  private readAll(): Result<AgentActivityEvent[]> {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return ok([]);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > MAX_EVENTS || !parsed.every(validAgentActivityEvent)) {
        return err("storage_failed", "Saved agent activity contains invalid or unsupported records.");
      }
      return ok(parsed);
    } catch {
      return err("storage_failed", "Could not read saved agent activity.", true);
    }
  }
}
