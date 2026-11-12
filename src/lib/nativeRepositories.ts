import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MemoryRecord, MemoryRepository, MemoryScope } from "../core/memory";
import type { KnowledgeChunk, KnowledgeRepository } from "../core/knowledge";
import { err, ok, type Result } from "../core/result";
import { LocalStorageMemoryRepository, rankMemories, type StorageLike } from "./memoryStorage";
import { LocalStorageKnowledgeRepository } from "./knowledgeStorage";

function failure(error: unknown, fallback: string): Result<never> {
  return err("storage_failed", error instanceof Error ? error.message : fallback, true);
}


export class WorkspaceMemoryRepository implements MemoryRepository {
  private readonly local: LocalStorageMemoryRepository;
  private migration?: Promise<MemoryRecord[]>;
  constructor(storage: StorageLike) { this.local = new LocalStorageMemoryRepository(storage); }
  private async all(): Promise<MemoryRecord[]> {
    if (!isTauri()) { const result=await this.local.exportAll(); if(!result.ok) throw new Error(result.error.message); return result.value; }
    if (!this.migration) {
      const pending = (async () => {
        const records = await invoke<MemoryRecord[]>("load_memories");
        const legacy = await this.local.exportAll();
        if (!legacy.ok) throw new Error(legacy.error.message);
        const existing = new Set(records.map(record => record.id));
        // Import only missing IDs: retries after a partial migration are safe
        // and never overwrite newer native edits with stale browser data.
        for (const record of legacy.value) {
          if (!existing.has(record.id)) await invoke("save_memory",{record});
        }
        return records.length ? [...records, ...legacy.value.filter(record => !existing.has(record.id))] : legacy.value;
      })();
      this.migration = pending.catch(error => { this.migration = undefined; throw error; });
    }
    return this.migration;
  }
  async getById(id:MemoryRecord["id"]):Promise<Result<MemoryRecord|null>> {
    try { return ok((await this.all()).find(record=>record.id===id)??null); }
    catch(e) { return failure(e,"Could not load memory."); }
  }
  async exportAll():Promise<Result<MemoryRecord[]>> {
    try { return ok(await this.all()); }
    catch(e) { return failure(e,"Could not export memories."); }
  }
  async list(scope:MemoryScope,limit:number,projectId?:string):Promise<Result<MemoryRecord[]>> {
    try { const records=await this.all(); return ok(records.filter(r=>(scope==="all"||r.scope===scope)&&(scope!=="project"||(!!projectId&&r.projectId===projectId))).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,limit)); }
    catch(e){return failure(e,"Could not load memories.");}
  }
  async search(query:string,scope:MemoryScope,limit:number,projectId?:string):Promise<Result<MemoryRecord[]>> {
    try {
      const records=await this.all();
      const scoped=records.filter(record=>(scope==="all"||record.scope===scope)&&(scope!=="project"||(!!projectId&&record.projectId===projectId)));
      return ok(rankMemories(scoped,query).slice(0,limit));
    } catch(e) { return failure(e,"Could not search memories."); }
  }
  async save(record:MemoryRecord):Promise<Result<void>> {
    if(!isTauri())return this.local.save(record);
    try { await invoke("save_memory",{record}); this.migration=undefined; return ok(undefined); } catch(e){return failure(e,"Could not save memory.");}
  }
  async delete(id:MemoryRecord["id"]):Promise<Result<void>> {
    if(!isTauri())return this.local.delete(id);
    try { await invoke("delete_memory",{id}); this.migration=undefined; return ok(undefined); } catch(e){return failure(e,"Could not delete memory.");}
  }
}

export interface KnowledgeDocumentSummary { documentId:string; fileName:string; chunkCount:number; characterCount:number; }
export class WorkspaceKnowledgeRepository implements KnowledgeRepository {
  private readonly local: LocalStorageKnowledgeRepository;
  private migration?: Promise<KnowledgeChunk[]>;
  constructor(storage:StorageLike){this.local=new LocalStorageKnowledgeRepository(storage);}
  private async all():Promise<KnowledgeChunk[]> {
    if(!isTauri()){const exported=await this.local.exportAll();if(!exported.ok)throw new Error(exported.error.message);return exported.value;}
    if (!this.migration) {
      const pending = (async()=>{
        const chunks=await invoke<KnowledgeChunk[]>("load_knowledge_chunks");
        const legacy=await this.local.exportAll();
        if(!legacy.ok)throw new Error(legacy.error.message);
        const existing = new Set(chunks.map(chunk => chunk.id));
        const missing = legacy.value.filter(chunk => !existing.has(chunk.id));
        // Upsert only missing chunks so interrupted first-launch migrations
        // can resume without replacing newer native document versions.
        if(missing.length) await invoke("save_knowledge_chunks",{chunks:missing});
        return chunks.length ? [...chunks, ...missing] : legacy.value;
      })();
      this.migration = pending.catch(error => { this.migration = undefined; throw error; });
    }
    return this.migration;
  }
  private async persist(chunks:KnowledgeChunk[]):Promise<Result<void>> {
    if(!isTauri())return this.local.add(chunks);
    try{await invoke("save_knowledge_chunks",{chunks});this.migration=Promise.resolve(chunks);return ok(undefined);}catch(e){return failure(e,"Could not persist project knowledge.");}
  }
  async add(chunks:KnowledgeChunk[]):Promise<Result<void>> {const all=await this.readResult();if(!all.ok)return all;const ids=new Set(chunks.map(c=>c.id));return this.persist([...all.value.filter(c=>!ids.has(c.id)),...chunks]);}
  async replaceDocument(documentId:string,projectId:string,chunks:KnowledgeChunk[]):Promise<Result<void>> {
    if(!isTauri())return this.local.replaceDocument(documentId,projectId,chunks);
    try {
      await invoke("replace_knowledge_document",{documentId,projectId,chunks});
      this.migration=undefined;
      return ok(undefined);
    } catch(e) { return failure(e,"Could not replace project knowledge document."); }
  }
  async exportAll():Promise<Result<KnowledgeChunk[]>> { return this.readResult(); }
  async getByIds(ids:string[]):Promise<Result<KnowledgeChunk[]>> {const all=await this.readResult();if(!all.ok)return all;const set=new Set(ids);return ok(all.value.filter(c=>set.has(c.id)));}
  async search(query:string,projectId:string,limit:number):Promise<Result<KnowledgeChunk[]>> {
    if(!isTauri())return this.local.search(query,projectId,limit);
    const all=await this.readResult();if(!all.ok)return all;
    const terms=[...new Set(query.toLocaleLowerCase().match(/[\\p{L}\\p{N}]+/gu)??[])];
    const ranked=all.value.filter(c=>c.projectId===projectId).map(chunk=>({chunk,score:terms.reduce((n,t)=>n+(chunk.text.toLocaleLowerCase().includes(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    return ok(ranked.slice(0,limit).map(x=>x.chunk));
  }
  async searchAll(query:string,limit:number):Promise<Result<KnowledgeChunk[]>> {
    if(!query.trim()||!Number.isInteger(limit)||limit<1||limit>100)return err("validation","Workspace knowledge search query or limit is invalid.");
    const all=await this.readResult();if(!all.ok)return all;
    const terms=[...new Set(query.toLocaleLowerCase().match(/[\\p{L}\\p{N}]+/gu)??[])];
    if(!terms.length)return ok([]);
    const ranked=all.value.map(chunk=>({chunk,score:terms.reduce((n,t)=>n+(chunk.text.toLocaleLowerCase().includes(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    return ok(ranked.slice(0,limit).map(x=>x.chunk));
  }
  async removeDocument(documentId:string,projectId:string):Promise<Result<void>> {
    if(!isTauri())return this.local.removeDocument(documentId,projectId);
    try {
      await invoke("delete_knowledge_document",{documentId,projectId});
      this.migration=undefined;
      return ok(undefined);
    } catch(e) { return failure(e,"Could not remove project knowledge document."); }
  }
  async listDocuments(projectId:string):Promise<Result<KnowledgeDocumentSummary[]>> {
    const all=await this.readResult();if(!all.ok)return all;
    const grouped=new Map<string,KnowledgeDocumentSummary>();
    for(const chunk of all.value.filter(c=>c.projectId===projectId)){const item=grouped.get(chunk.documentId)??{documentId:chunk.documentId,fileName:chunk.sourceLabel,chunkCount:0,characterCount:0};item.chunkCount++;item.characterCount+=chunk.text.length;grouped.set(chunk.documentId,item);}
    return ok([...grouped.values()].sort((a,b)=>a.fileName.localeCompare(b.fileName)));
  }
  private async readResult():Promise<Result<KnowledgeChunk[]>> {try{return ok(await this.all());}catch(e){return failure(e,"Could not load project knowledge.");}}
}
