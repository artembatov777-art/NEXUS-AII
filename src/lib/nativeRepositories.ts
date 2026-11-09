import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MemoryRecord, MemoryRepository, MemoryScope } from "../core/memory";
import type { KnowledgeChunk, KnowledgeRepository } from "../core/knowledge";
import { err, ok, type Result } from "../core/result";
import { LocalStorageMemoryRepository, type StorageLike } from "./memoryStorage";
import { LocalStorageKnowledgeRepository } from "./knowledgeStorage";

function failure(error: unknown, fallback: string): Result<never> {
  return err("storage_failed", error instanceof Error ? error.message : fallback, true);
}

function rank(records: MemoryRecord[], query: string): MemoryRecord[] {
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\\p{L}\\p{N}]+/gu) ?? [])];
  return records.map(record => {
    const haystack = [record.content, record.category, ...record.tags].join(" ").toLocaleLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return { record, score };
  }).filter(item => item.score > 0).sort((a,b) => b.score-a.score || b.record.updatedAt-a.record.updatedAt).map(item => item.record);
}

export class WorkspaceMemoryRepository implements MemoryRepository {
  private readonly local: LocalStorageMemoryRepository;
  private migration?: Promise<MemoryRecord[]>;
  constructor(storage: StorageLike) { this.local = new LocalStorageMemoryRepository(storage); }
  private async all(): Promise<MemoryRecord[]> {
    if (!isTauri()) { const result=await this.local.list("all",200); if(!result.ok) throw new Error(result.error.message); return result.value; }
    this.migration ??= (async () => {
      let records = await invoke<MemoryRecord[]>("load_memories");
      if (!records.length) {
        const legacy = await this.local.list("all",200);
        if (!legacy.ok) throw new Error(legacy.error.message);
        for (const record of legacy.value) await invoke("save_memory",{record});
        records = legacy.value;
      }
      return records;
    })();
    return this.migration;
  }
  async list(scope:MemoryScope,limit:number,projectId?:string):Promise<Result<MemoryRecord[]>> {
    try { const records=await this.all(); return ok(records.filter(r=>(scope==="all"||r.scope===scope)&&(r.scope!=="project"||!projectId||r.projectId===projectId)).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,limit)); }
    catch(e){return failure(e,"Could not load memories.");}
  }
  async search(query:string,scope:MemoryScope,limit:number,projectId?:string):Promise<Result<MemoryRecord[]>> {
    const records=await this.list(scope,200,projectId); if(!records.ok)return records; return ok(rank(records.value,query).slice(0,limit));
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
    this.migration ??= (async()=>{
      let chunks=await invoke<KnowledgeChunk[]>("load_knowledge_chunks");
      if(!chunks.length){
        const legacy=await this.local.exportAll(); if(!legacy.ok)throw new Error(legacy.error.message);
        if(legacy.value.length) await invoke("save_knowledge_chunks",{chunks:legacy.value});
        chunks=legacy.value;
      }
      return chunks;
    })();
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
  async getByIds(ids:string[]):Promise<Result<KnowledgeChunk[]>> {const all=await this.readResult();if(!all.ok)return all;const set=new Set(ids);return ok(all.value.filter(c=>set.has(c.id)));}
  async search(query:string,projectId:string,limit:number):Promise<Result<KnowledgeChunk[]>> {
    if(!isTauri())return this.local.search(query,projectId,limit);
    const all=await this.readResult();if(!all.ok)return all;
    const terms=[...new Set(query.toLocaleLowerCase().match(/[\\p{L}\\p{N}]+/gu)??[])];
    const ranked=all.value.filter(c=>c.projectId===projectId).map(chunk=>({chunk,score:terms.reduce((n,t)=>n+(chunk.text.toLocaleLowerCase().includes(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
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
