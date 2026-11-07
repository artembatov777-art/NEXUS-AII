import { err, ok, type Result } from "./result";

export type MemoryId = string & { readonly __brand: "MemoryId" };
export type MemoryScope = "all" | "profile" | "project" | "conversation";
export type MemoryCategory = "preference" | "goal" | "fact" | "workflow" | "project";

export interface MemorySource {
  type: "user_confirmed" | "conversation" | "import";
  referenceId?: string;
  label: string;
}

export interface MemoryRecord {
  id: MemoryId;
  content: string;
  category: MemoryCategory;
  scope: Exclude<MemoryScope, "all">;
  source: MemorySource;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface MemoryRepository {
  list(scope: MemoryScope, limit: number): Promise<Result<MemoryRecord[]>>;
  search(query: string, scope: MemoryScope, limit: number): Promise<Result<MemoryRecord[]>>;
  save(record: MemoryRecord): Promise<Result<void>>;
  delete(id: MemoryId): Promise<Result<void>>;
}

export interface MemoryIdFactory {
  memoryId(): MemoryId;
}

export interface MemoryClock {
  now(): number;
}

export interface RememberInput {
  content: string;
  category: MemoryCategory;
  scope: Exclude<MemoryScope, "all">;
  source: MemorySource;
  tags?: string[];
}

/**
 * The caller must only pass confirmedByUser after a direct user confirmation.
 * This keeps consent explicit at the application boundary.
 */
export interface MemoryWriteApproval {
  confirmedByUser: true;
}

export class MemoryService {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly ids: MemoryIdFactory,
    private readonly clock: MemoryClock
  ) {}

  async remember(
    input: RememberInput,
    approval: MemoryWriteApproval
  ): Promise<Result<MemoryRecord>> {
    if (approval.confirmedByUser !== true) {
      return err("permission_denied", "User confirmation is required to save a memory.");
    }

    const content = input.content.trim();
    if (!content) return err("validation", "Memory content cannot be empty.");
    if (content.length > 4_000) return err("validation", "Memory content must be 4,000 characters or fewer.");

    const label = input.source.label.trim();
    if (!label) return err("validation", "A memory source label is required.");

    const now = this.clock.now();
    const record: MemoryRecord = {
      id: this.ids.memoryId(),
      content,
      category: input.category,
      scope: input.scope,
      source: { ...input.source, label },
      tags: [...new Set((input.tags ?? []).map(tag => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20),
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };

    const saved = await this.repository.save(record);
    if (!saved.ok) return saved;
    return ok(record);
  }

  async list(scope: MemoryScope = "all", limit = 50): Promise<Result<MemoryRecord[]>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return err("validation", "Memory list limit must be between 1 and 200.");
    }
    return this.repository.list(scope, limit);
  }

  async search(query: string, scope: MemoryScope = "all", limit = 10): Promise<Result<MemoryRecord[]>> {
    const normalized = query.trim();
    if (!normalized) return err("validation", "Memory search query cannot be empty.");
    if (normalized.length > 500) return err("validation", "Memory search query is too long.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return err("validation", "Memory search limit must be between 1 and 50.");
    }
    return this.repository.search(normalized, scope, limit);
  }

  async forget(id: MemoryId): Promise<Result<void>> {
    return this.repository.delete(id);
  }
}
