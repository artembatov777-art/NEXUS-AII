import { err, ok, type Result } from './result';

export const MAX_DRAFT_FILES = 8;
export const MAX_EDIT_BYTES = 48_000;
const encoder = new TextEncoder();

export interface Replacement {
  path: string;
  from: string;
  to: string;
}

export interface WorkspaceSnapshot {
  content: string;
  revision?: string;
}

export interface DraftFile {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly revision?: string;
}

export interface ReplacementSpan extends Replacement {
  readonly offset: number;
}

type ReadFile = (path: string) => Promise<Result<WorkspaceSnapshot>>;

export function parseReplacements(input: unknown): Result<Replacement[]> {
  const changes: unknown[] = Array.isArray(input) ? input : [input];
  if (!changes.length || changes.length > MAX_DRAFT_FILES) return err('validation', 'Drafts require between one and eight files.');

  const replacements: Replacement[] = [];
  const paths = new Set<string>();
  for (const change of changes) {
    if (!change || typeof change !== 'object') return err('validation', 'Invalid draft input.');
    const { path, from, to } = change as Record<string, unknown>;
    if (typeof path !== 'string' || typeof from !== 'string' || !from || typeof to !== 'string' || from === to ||
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(encoder.encode(to)) !== to) {
      return err('validation', 'Specify a file and a nonempty, unique span to replace.');
    }
    if (paths.has(path)) return err('validation', 'A draft cannot edit the same path twice.');
    paths.add(path);
    replacements.push({ path, from, to });
  }
  return ok(replacements);
}

/** Shared by manual drafts and agent plans. All snapshots come from the caller's Gateway. */
export async function prepareChanges(changes: readonly Replacement[], read: ReadFile, signal: AbortSignal) {
  const files: DraftFile[] = [];
  const spans: ReplacementSpan[] = [];
  const revisions = new Set<string>();
  for (const { path, from, to } of changes) {
    if (signal.aborted) return err('cancelled', 'Draft cancelled.');
    const result = await read(path);
    if (!result.ok) return result;
    const { content: before, revision } = result.value;
    if (revision && revisions.has(revision)) return err('validation', 'A draft cannot edit the same file through two paths.');
    if (revision) revisions.add(revision);
    const index = before.indexOf(from);
    if (index < 0 || index !== before.lastIndexOf(from)) return err('validation', 'Draft span must occur exactly once.');
    const after = before.slice(0, index) + to + before.slice(index + from.length);
    if (encoder.encode(after).byteLength > MAX_EDIT_BYTES) return err('validation', 'Draft result exceeds 48 KB.');
    files.push(Object.freeze({ path, before, after, revision }));
    spans.push(Object.freeze({ path, from, to, offset: index }));
  }
  if (signal.aborted) return err('cancelled', 'Draft cancelled.');
  return ok({ files: Object.freeze(files), spans: Object.freeze(spans) });
}

