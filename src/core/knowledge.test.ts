import {describe,it,expect} from "vitest";
import {HybridMemoryRetriever,KnowledgeRetrievalService,type MemorySearchRepository,type EmbeddingProvider,type VectorMemoryIndex,type KnowledgeRepository} from "./knowledge";
import {ok} from "./result";
import type {MemoryRecord} from "./memory";
const rec=(id:string):MemoryRecord=>({id:id as MemoryRecord["id"],content:"Project architecture notes",category:"project",scope:"project",source:{type:"import",label:"design.pdf",referenceId:"doc-1"},tags:["architecture"],createdAt:1,updatedAt:1,schemaVersion:1});
describe("knowledge retrieval",()=>{
 it("combines lexical and semantic results with explicit citations",async()=>{
  const records=[rec("lex"),rec("semantic")];const repository:MemorySearchRepository={search:async()=>ok([records[0]]),getByIds:async ids=>ok(records.filter(r=>ids.includes(r.id)))};
  const embeddings:EmbeddingProvider={embed:async()=>ok([[1,0]])};const vectors:VectorMemoryIndex={upsert:async()=>{},remove:async()=>{},search:async()=>[{id:"semantic",score:.99}]};
  const ranked=await new HybridMemoryRetriever(repository,embeddings,vectors).search("design systems","all",5);
  expect(ranked.ok&&ranked.value[0].record.id).toBe("semantic");
 });
 it("falls back to lexical retrieval when embeddings fail",async()=>{
  const records=[rec("lex")];const repository:MemorySearchRepository={search:async()=>ok(records),getByIds:async()=>ok(records)};
  const embeddings:EmbeddingProvider={embed:async()=>({ok:false,error:{code:"provider_unavailable",message:"offline",retryable:true}})};
  const vectors:VectorMemoryIndex={upsert:async()=>{},remove:async()=>{},search:async()=>[]};
  const result=await new HybridMemoryRetriever(repository,embeddings,vectors).search("architecture");
  expect(result.ok&&result.value[0].record.id).toBe("lex");
 });
 it("never returns semantic matches from another project",async()=>{
  const chunks=[
   {id:"same-project",documentId:"d1",projectId:"p1",text:"Allowed project content",sourceLabel:"allowed.md"},
   {id:"other-project",documentId:"d2",projectId:"p2",text:"Private unrelated project content",sourceLabel:"private.md"}
  ];
  const repository:KnowledgeRepository={
   add:async()=>ok(undefined),removeDocument:async()=>ok(undefined),
   search:async(_query,projectId)=>ok(chunks.filter(chunk=>chunk.projectId===projectId)),
   getByIds:async ids=>ok(chunks.filter(chunk=>ids.includes(chunk.id)))
  };
  const embeddings:EmbeddingProvider={embed:async()=>ok([[1,0]])};
  const vectors:VectorMemoryIndex & {hasProject:()=>Promise<boolean>}={
   upsert:async()=>{},remove:async()=>{},search:async()=>[
    {id:"same-project",score:.8},{id:"other-project",score:.99}
   ],hasProject:async()=>true
  };
  const result=await new KnowledgeRetrievalService(repository,embeddings,vectors).retrieve("project content","p1");
  expect(result.ok).toBe(true);
  if(result.ok){
   expect(result.value.context).toContain("Allowed project content");
   expect(result.value.context).not.toContain("Private unrelated project content");
   expect(result.value.citations.map(citation=>citation.documentId)).toEqual(["d1"]);
  }
 });
 it("returns knowledge citations alongside retrieved context",async()=>{
  const repository:KnowledgeRepository={add:async()=>ok(undefined),removeDocument:async()=>ok(undefined),search:async()=>ok([{id:"c1",documentId:"d1",projectId:"p1",text:"Architecture decisions",sourceLabel:"design.pdf",page:4,section:"Core"}])};
  const result=await new KnowledgeRetrievalService(repository).retrieve("architecture","p1");
  expect(result.ok&&result.value.citations[0]).toMatchObject({documentId:"d1",page:4,sourceLabel:"design.pdf"});
  expect(result.ok&&result.value.context).toContain("page 4");
 });
});
