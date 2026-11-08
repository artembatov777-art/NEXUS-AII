import {describe,it,expect} from "vitest";
import {LocalStorageTraceSink} from "./traceStorage";
class MemoryStorage{private data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}}
describe("LocalStorageTraceSink",()=>{it("persists bounded trace events and filters by run",async()=>{const sink=new LocalStorageTraceSink(new MemoryStorage());await sink.append({traceId:"t1",runId:"r1",name:"agent",status:"started",timestamp:1});await sink.append({traceId:"t2",runId:"r2",name:"tool",status:"completed",timestamp:2});const result=await sink.list({runId:"r1"});expect(result.ok&&result.value).toHaveLength(1);});});
