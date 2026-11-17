import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelMessage } from '../src/core/model';

export async function loadHistory(path: string): Promise<ModelMessage[]> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (Buffer.byteLength(raw) > 1_000_000) throw new Error('History exceeds the 1 MB limit.');
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('messages' in data) || !Array.isArray(data.messages) || data.messages.length > 98 || data.messages.length % 2 !== 0 || !data.messages.every((m: unknown, i: number) => !!m && typeof m === 'object' && 'role' in m && m.role === (i % 2 === 0 ? 'user' : 'assistant') && 'content' in m && typeof m.content === 'string' && Buffer.byteLength(m.content) <= 100_000)) throw new Error('Invalid history format.');
  return data.messages.map((m: ModelMessage) => ({ role: m.role, content: m.content }));
}

export async function saveHistory(path: string, messages: ModelMessage[]): Promise<void> {
  const serialized = JSON.stringify({ version: 1, messages });
  if (Buffer.byteLength(serialized) > 1_000_000 || messages.length > 98) throw new Error('History limit reached.');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}
