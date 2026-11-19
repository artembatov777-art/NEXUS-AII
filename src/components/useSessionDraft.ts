import { useState, type Dispatch, type SetStateAction } from "react";

/** Drafts are deliberately memory-only; conversation messages use the existing repository. */
export function useSessionDraft(id: string | null): [string, Dispatch<SetStateAction<string>>] {
  const [drafts, setDrafts] = useState<Map<string | null, string>>(() => new Map());
  return [drafts.get(id) ?? "", next => setDrafts(previous => {
    const value = typeof next === "function" ? next(previous.get(id) ?? "") : next;
    const updated = new Map(previous);
    if (value) updated.set(id, value); else updated.delete(id);
    return updated;
  })];
}
