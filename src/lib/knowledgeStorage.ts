import type { KnowledgeChunk, KnowledgeRepository } from "../core/knowledge";
import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";
const KEY="nexus-au:knowledge:v1";
function valid(value:unknown):value is KnowledgeChunk {if(!value||typeof value!=="object")return false;const c=value as Partial<KnowledgeChunk>;return typeof c.id==="string"&&typeof c.documentId==="string"&&typeof c.projectId==="string"&&typeof c.text==="string"&&typeof c.sourceLabel==="string"&&c.text.length<=12000;}
const terms=(s:string):string[]=>Array.from(s.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
export class LocalStorageKnowledgeRepository implements KnowledgeRepository{
 constructor(private readonly storage:StorageLike,private readonly key=KEY){}
 async add(chunks:KnowledgeChunk[]):Promise<Result<void>>{if(chunks.length>500||!chunks.every(valid))return err("validation","Knowledge chunks are invalid or exceed the import limit.");const current=this.read();if(!current.ok)return current;try{const ids=new Set(chunks.map(c=>c.id));this.storage.setItem(this.key,JSON.stringify([...current.value.filter(c=>!ids.has(c.id)),...chunks]));return ok(undefined);}catch{return err("storage_failed","Could not store knowledge chunks.",true);}}
 async search(query:string,projectId:string,limit:number):Promise<Result<KnowledgeChunk[]>>{const current=this.read();if(!current.ok)return current;const queryTerms=[...new Set(terms(query))];if(!queryTerms.length)return ok([]);const ranked=current.value.filter(c=>c.projectId===projectId).map(chunk=>({chunk,score:queryTerms.reduce((n,t)=>n+(terms(chunk.text).includes(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);return ok(ranked.slice(0,limit).map(x=>x.chunk));}
 async removeDocument(documentId:string,projectId:string):Promise<Result<void>>{const current=this.read();if(!current.ok)return current;try{this.storage.setItem(this.key,JSON.stringify(current.value.filter(c=>c.documentId!==documentId||c.projectId!==projectId)));return ok(undefined);}catch{return err("storage_failed","Could not remove knowledge document.",true);}}
 private read():Result<KnowledgeChunk[]>{try{const raw=this.storage.getItem(this.key);if(!raw)return ok([]);const data:unknown=JSON.parse(raw);return Array.isArray(data)&&data.every(valid)?ok(data):err("storage_failed","Knowledge storage contains invalid data.");}catch{return err("storage_failed","Could not read knowledge storage.",true);}}
}
