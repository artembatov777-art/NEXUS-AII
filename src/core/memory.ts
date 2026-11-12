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
  projectId?: string;
  source: MemorySource;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface MemoryRepository {
  list(scope: MemoryScope, limit: number, projectId?: string): Promise<Result<MemoryRecord[]>>;
  search(query: string, scope: MemoryScope, limit: number, projectId?: string): Promise<Result<MemoryRecord[]>>;
  getById(id: MemoryId): Promise<Result<MemoryRecord | null>>;
  exportAll(): Promise<Result<MemoryRecord[]>>;
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
  projectId?: string;
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

    if (input.scope === "project" && !input.projectId?.trim()) return err("validation", "Project-scoped memories require a project ID.");
    const label = input.source.label.trim();
    if (!label) return err("validation", "A memory source label is required.");

    const now = this.clock.now();
    const record: MemoryRecord = {
      id: this.ids.memoryId(),
      content,
      category: input.category,
      scope: input.scope,
      ...(input.scope === "project" ? { projectId: input.projectId } : {}),
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

  async list(scope: MemoryScope = "all", limit = 50, projectId?: string): Promise<Result<MemoryRecord[]>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return err("validation", "Memory list limit must be between 1 and 200.");
    }
    if (scope === "project" && !projectId?.trim()) return err("validation", "Project-scoped memory listing requires a project ID.");
    return this.repository.list(scope, limit, projectId);
  }

  async search(query: string, scope: MemoryScope = "all", limit = 10, projectId?: string): Promise<Result<MemoryRecord[]>> {
    const normalized = query.trim();
    if (!normalized) return err("validation", "Memory search query cannot be empty.");
    if (normalized.length > 500) return err("validation", "Memory search query is too long.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return err("validation", "Memory search limit must be between 1 and 50.");
    }
    if (scope === "project" && !projectId?.trim()) return err("validation", "Project-scoped memory search requires a project ID.");
    return this.repository.search(normalized, scope, limit, projectId);
  }

  async revise(id: MemoryId, changes: Partial<Pick<MemoryRecord, "content" | "category" | "scope" | "projectId" | "tags" | "source">>): Promise<Result<MemoryRecord>> {
    const current = await this.repository.getById(id);
    if (!current.ok) return current;
    const existing = current.value;
    if (!existing) return err("validation", "Memory record was not found.");
    const content = changes.content === undefined ? existing.content : changes.content.trim();
    if (!content || content.length > 4_000) return err("validation", "Memory content must contain 1 to 4,000 characters.");
    if ((changes.scope ?? existing.scope) === "project" && !(changes.projectId ?? existing.projectId)?.trim()) return err("validation", "Project-scoped memories require a project ID.");
    const nextScope = changes.scope ?? existing.scope;
    const nextProjectId = nextScope === "project" ? (changes.projectId ?? existing.projectId) : undefined;
    const next: MemoryRecord = {
      ...existing,
      ...changes,
      scope: nextScope,
      ...(nextProjectId ? { projectId: nextProjectId } : {}),
      content,
      tags: changes.tags ? [...new Set(changes.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20) : existing.tags,
      source: changes.source ? { ...changes.source, label: changes.source.label.trim() } : existing.source,
      updatedAt: this.clock.now()
    };
    if (!nextProjectId) delete next.projectId;
    if (!next.source.label) return err("validation", "A memory source label is required.");
    const saved = await this.repository.save(next);
    return saved.ok ? ok(next) : saved;
  }

  async exportAll(): Promise<Result<MemoryRecord[]>> {
    return this.repository.exportAll();
  }

  async forget(id: MemoryId): Promise<Result<void>> {
    return this.repository.delete(id);
  }
}
