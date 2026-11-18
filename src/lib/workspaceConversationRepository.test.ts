import { describe, expect, it } from "vitest";
import type { Conversation, ConversationId, Message } from "../core/domain";
import type { StorageAdapter } from "./storage";
import { WorkspaceConversationRepository } from "./workspaceConversationRepository";
class MemoryStorage implements StorageAdapter {
  private values = new Map<string,string>();
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){this.values.set(key,value);}
}
const sample=(id:string,content:string,projectId?:string):Conversation=>({
  id:id as ConversationId,title:"Conversation",
  messages:[{id:(id+"-message") as Message["id"],role:"user",content,createdAt:10,metadata:{sourceReferences:[{documentId:"doc-1",sourceLabel:"Manual",page:4,chunkId:"chunk-1"}]}}],
  createdAt:10,updatedAt:10,schemaVersion:1,...(projectId?{projectId}:{})
});
describe("WorkspaceConversationRepository",()=>{
  it("round-trips project ownership and source citations",async()=>{
    const repository=new WorkspaceConversationRepository(new MemoryStorage());
    const item=sample("conversation-1","Remember this","project-1");
    expect((await repository.save(item)).ok).toBe(true);
    expect(await repository.get(item.id)).toMatchObject({ok:true,value:{projectId:"project-1",messages:[{content:"Remember this",metadata:{sourceReferences:[{documentId:"doc-1",page:4}]}}]}});
  });
  it("round-trips generated image attachment metadata", async () => {
    const repository = new WorkspaceConversationRepository(new MemoryStorage());
    const item = sample("conversation-image", "Generated image");
    item.messages[0]!.metadata = {
      imageAttachment: {
        mimeType: "image/png", data: "iVBORw0KGgo=", byteLength: 8,
        model: "gemini-3.1-flash-image", aspectRatio: "16:9", imageSize: "1K"
      }
    };
    expect((await repository.save(item)).ok).toBe(true);
    expect(await repository.get(item.id)).toMatchObject({
      ok: true,
      value: { messages: [{ metadata: { imageAttachment: { model: "gemini-3.1-flash-image", aspectRatio: "16:9" } } }] }
    });
  });

  it("serializes concurrent upserts without losing conversations",async()=>{
    const repository=new WorkspaceConversationRepository(new MemoryStorage());
    const results=await Promise.all([repository.save(sample("conversation-a","A")),repository.save(sample("conversation-b","B"))]);
    expect(results.every(result=>result.ok)).toBe(true);
    expect(await repository.list()).toMatchObject({ok:true,value:[{id:"conversation-a",messageCount:1},{id:"conversation-b",messageCount:1}]});
  });
  it("deletes only the requested conversation",async()=>{
    const repository=new WorkspaceConversationRepository(new MemoryStorage());
    await repository.save(sample("conversation-a","A")); await repository.save(sample("conversation-b","B"));
    expect((await repository.delete("conversation-a" as ConversationId)).ok).toBe(true);
    expect(await repository.get("conversation-a" as ConversationId)).toMatchObject({ok:true,value:null});
    expect((await repository.get("conversation-b" as ConversationId)).ok).toBe(true);
  });
});
