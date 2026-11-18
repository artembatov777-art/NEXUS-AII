import { err, ok, type Result } from "../core/result";
import type { TraceEvent, TraceSink } from "../core/observability";
import type { StorageLike } from "./memoryStorage";
const KEY="nexus.trace-events.v1";
const MAX_EVENTS=5000;
const safeAttributes=(attributes:TraceEvent["attributes"]):TraceEvent["attributes"]=>{
 if(!attributes)return undefined;const safe:NonNullable<TraceEvent["attributes"]>={};
 for(const [key,value] of Object.entries(attributes)){if(/key|token|secret|password|authorization|content|prompt/i.test(key))continue;if(key.length<=60&&(typeof value==="string"?value.length<=200:typeof value==="number"||typeof value==="boolean"))safe[key]=value;}
 return safe;
};
export class LocalStorageTraceSink implements TraceSink {
 constructor(private readonly storage:StorageLike){}
 async append(event:TraceEvent):Promise<Result<void>>{
  try{const current=this.read();if(!current.ok)return current;const next=[...current.value,{...event,attributes:safeAttributes(event.attributes)}].slice(-MAX_EVENTS);const encoded=JSON.stringify(next);
   if(encoded.length>2_000_000)return err("storage_failed","Trace history exceeded the 2 MB storage budget.");
   this.storage.setItem(KEY,encoded);return ok(undefined);
  }catch{return err("storage_failed","Could not persist trace event.");}
 }
 async list(filter:{runId?:string;traceId?:string;limit?:number}={}):Promise<Result<TraceEvent[]>>{
  const limit=filter.limit??200;if(!Number.isInteger(limit)||limit<1||limit>1000)return err("validation","Trace limit must be between 1 and 1,000.");
  const current=this.read();if(!current.ok)return current;
  return ok(current.value.filter(e=>(!filter.runId||e.runId===filter.runId)&&(!filter.traceId||e.traceId===filter.traceId)).slice(-limit));
 }
 private read():Result<TraceEvent[]>{try{const raw=this.storage.getItem(KEY);if(!raw)return ok([]);const parsed:unknown=JSON.parse(raw);
  if(!Array.isArray(parsed)||parsed.length>MAX_EVENTS||parsed.some(e=>!e||typeof e!=="object"||typeof e.traceId!=="string"||typeof e.runId!=="string"||typeof e.name!=="string"||typeof e.timestamp!=="number"))return err("storage_failed","Stored trace history is invalid.");
  return ok(parsed as TraceEvent[]);
 }catch{return err("storage_failed","Could not read trace history.");}}
}
