import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { MAX_DRAFT_FILES, MAX_EDIT_BYTES } from '../src/core/workspaceChangePreview';
export { MAX_DRAFT_FILES, MAX_EDIT_BYTES };
export const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// JSON encodes some characters with six bytes.
export const MAX_INTENT_BYTES = MAX_DRAFT_FILES * MAX_EDIT_BYTES * 7;
export const MAX_STEPS_BYTES = 128_000;
export const isRecoveryId = (id: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);

export async function assertPrivateDirectory(path: string) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077)) {
    throw new Error('Workspace state directory is not private');
  }
}

export async function assertPrivateJournal(file: FileHandle, limit: number) {
  const metadata = await file.stat();
  if (!metadata.isFile() || metadata.uid !== process.getuid?.() || metadata.nlink !== 1 ||
      (metadata.mode & 0o077) || metadata.size > limit) {
    throw new Error('Invalid workspace journal');
  }
}

async function readBoundedJournal(file: FileHandle, limit: number, completeLines: boolean) {
  const bytes = Buffer.alloc(limit + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await file.read(bytes, offset, bytes.length - offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  if (offset > limit) throw new Error('Oversized workspace journal');
  const frame = bytes.subarray(0, offset);
  const end = completeLines ? frame.lastIndexOf(10) + 1 : offset;
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(frame.subarray(0, end));
}

export async function readPrivateJournal(path: string, limit: number, completeLines = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    await assertPrivateJournal(file, limit);
    return await readBoundedJournal(file, limit, completeLines);
  } finally { await file.close(); }
}

/** Inspection on hosts without the private write store. Never authorizes a write. */
export async function readInspectionJournal(path: string, limit: number, completeLines = false) {
  if (process.platform === 'linux') return readPrivateJournal(path, limit, completeLines);
  const entry = await lstat(path, { bigint: true });
  if (!entry.isFile() || entry.nlink !== 1n || entry.size > BigInt(limit)) throw new Error('Invalid workspace journal');
  const file = await open(path, 'r');
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== entry.dev || opened.ino !== entry.ino) {
      throw new Error('Workspace journal changed while opening');
    }
    return await readBoundedJournal(file, limit, completeLines);
  } finally { await file.close(); }
}

export async function syncDirectory(path: string) {
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export interface RecoveryFile {
  path: string;
  revision: string;
  before: string;
  after: string;
  original?: string;
}

export interface RecoveryManifest {
  root: string;
  plan: string;
  planId?: string;
  rollbackOf?: string;
  files: readonly Omit<RecoveryFile, 'original'>[];
}

export function isIntentFile(file: unknown): file is RecoveryFile {
  if (!file || typeof file !== 'object') return false;
  const { path, revision, before, after } = file as Record<string, unknown>;
  return typeof path === 'string' && typeof revision === 'string' &&
    typeof before === 'string' && /^[a-f0-9]{64}$/.test(before) &&
    typeof after === 'string' && /^[a-f0-9]{64}$/.test(after);
}

export class WorkspaceRecoveryStore {
  constructor(private readonly directory: string) {}

  private file(id: string) {
    if (!isRecoveryId(id)) throw new Error('Invalid recovery ID');
    return join(this.directory, id + '.json');
  }

  async save(id: string, manifest: RecoveryManifest, originals: readonly string[]) {
    const parent = dirname(this.directory);
    await assertPrivateDirectory(parent);
    await mkdir(this.directory, { mode: 0o700 }).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
    await assertPrivateDirectory(this.directory);
    const payload = JSON.stringify({ version: 1, id, manifest, originals });
    const file = await open(this.file(id), 'wx', 0o600);
    try {
      await file.writeFile(payload);
      await file.sync();
    } finally { await file.close(); }
    await syncDirectory(this.directory);
    await syncDirectory(parent);
    return digest(payload);
  }

  async load(id: string, manifest: RecoveryManifest, checksum: unknown): Promise<string[]> {
    await assertPrivateDirectory(dirname(this.directory));
    await assertPrivateDirectory(this.directory);
    const payload = await readPrivateJournal(this.file(id), MAX_INTENT_BYTES);
    if (digest(payload) !== checksum) throw new Error('Recovery checksum mismatch');
    const record = JSON.parse(payload);
    if (record?.version !== 1 || record.id !== id || JSON.stringify(record.manifest) !== JSON.stringify(manifest) ||
        !Array.isArray(record.originals) || record.originals.length !== manifest.files.length ||
        !record.originals.every((original: unknown, index: number) =>
          typeof original === 'string' && Buffer.byteLength(original) <= MAX_EDIT_BYTES &&
          digest(original) === manifest.files[index].before)) {
      throw new Error('Recovery record does not match its intent');
    }
    return record.originals;
  }
}

export type EditEvidence =
  | { phase: 'dispatch-intent' | 'not-confirmed' }
  | { phase: 'applied'; revision: string };

function isEditRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 &&
    /^(?:\d+:\d+:-?\d+:\d+:\d+|win:\d+:[a-f0-9]{32}:-?\d+:-?\d+:\d+)$/.test(value);
}

/** Read only the durable prefix. A partial final append is not a receipt. */
export function parseEditEvidence(text: string, id: string, version: number, files: readonly RecoveryFile[]) {
  const evidence = new Map<string, EditEvidence>();
  let phase: string | undefined;
  let next = 0;
  for (const line of text.split('\n').slice(0, -1)) {
    const { checksum, ...step } = JSON.parse(line);
    if (version === 4 && digest(JSON.stringify({ runId: id, step })) !== checksum) {
      throw new Error('Invalid edit step checksum');
    }
    if (phase === undefined && step.phase === 'preflight-started') {
      phase = step.phase;
    } else if (phase === 'preflight-started' && ['preflight-passed', 'preflight-failed'].includes(step.phase)) {
      phase = step.phase;
    } else if (files[next]?.path === step.path && typeof step.path === 'string') {
      if ((phase === 'preflight-passed' || phase === 'applied') && step.phase === 'dispatch-intent') {
        evidence.set(step.path, { phase: 'dispatch-intent' });
      } else if (phase === 'dispatch-intent' && step.phase === 'not-confirmed') {
        evidence.set(step.path, { phase: 'not-confirmed' });
      } else if (phase === 'dispatch-intent' && step.phase === 'applied' && isEditRevision(step.revision)) {
        evidence.set(step.path, { phase: 'applied', revision: step.revision });
        next++;
      } else {
        throw new Error('Invalid edit phase transition');
      }
      phase = step.phase;
    } else {
      throw new Error('Edit step does not match its intent');
    }
  }
  return evidence;
}
