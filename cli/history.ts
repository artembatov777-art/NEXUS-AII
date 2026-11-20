import { constants } from 'node:fs';
import { lstat, open, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelMessage } from '../src/core/model';

const MAX_HISTORY_BYTES = 1_000_000;
const MAX_HISTORY_MESSAGES = 98;
const MAX_MESSAGE_BYTES = 100_000;

function validMessages(value: unknown): value is ModelMessage[] {
  return Array.isArray(value) &&
    value.length <= MAX_HISTORY_MESSAGES &&
    value.length % 2 === 0 &&
    value.every((message: unknown, index: number) =>
      !!message && typeof message === 'object' && !Array.isArray(message) &&
      'role' in message && message.role === (index % 2 === 0 ? 'user' : 'assistant') &&
      'content' in message && typeof message.content === 'string' &&
      Buffer.byteLength(message.content, 'utf8') <= MAX_MESSAGE_BYTES
    );
}

/**
 * Read at most the limit plus one byte. lstat and fstat reject non-files,
 * symlinks and replacements between lookup and open; O_NOFOLLOW is used on Unix.
 */
async function readBoundedHistory(path: string): Promise<string | null> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try { entry = await lstat(path, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!entry.isFile() || entry.nlink !== 1n) throw new Error('History must be a regular, unlinked file.');
  if (entry.size > BigInt(MAX_HISTORY_BYTES)) throw new Error('History exceeds the 1 MB limit.');

  const unixFlags = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const file = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : unixFlags));
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n ||
        opened.dev !== entry.dev || opened.ino !== entry.ino) {
      throw new Error('History changed while opening the file.');
    }
    if (opened.size > BigInt(MAX_HISTORY_BYTES)) throw new Error('History exceeds the 1 MB limit.');

    const bytes = Buffer.alloc(MAX_HISTORY_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_HISTORY_BYTES) throw new Error('History exceeds the 1 MB limit.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { throw new Error('Invalid history UTF-8 encoding.'); }
  } finally { await file.close(); }
}

export async function loadHistory(path: string): Promise<ModelMessage[]> {
  const raw = await readBoundedHistory(path);
  if (raw === null) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Invalid history format.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      !('version' in parsed) || parsed.version !== 1 ||
      !('messages' in parsed) || !validMessages(parsed.messages)) {
    throw new Error('Invalid history format.');
  }
  return parsed.messages.map(message => ({ role: message.role, content: message.content }));
}

export async function saveHistory(path: string, messages: ModelMessage[]): Promise<void> {
  if (!validMessages(messages)) throw new Error('Invalid history format.');
  const serialized = JSON.stringify({ version: 1, messages });
  if (Buffer.byteLength(serialized, 'utf8') > MAX_HISTORY_BYTES) throw new Error('History limit reached.');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(serialized, 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}
