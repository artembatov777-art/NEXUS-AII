import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export const MAX_DRAFT_FILES = 8;
export const MAX_EDIT_BYTES = 48_000;
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

export async function readPrivateJournal(path: string, limit: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    await assertPrivateJournal(file, limit);
    const bytes = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new Error('Oversized workspace journal');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, offset));
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
