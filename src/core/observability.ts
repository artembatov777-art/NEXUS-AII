import { err, ok, type Result } from "./result";
export type TraceStatus="started"|"progress"|"waiting_for_approval"|"completed"|"failed"|"cancelled";
export interface TraceEvent { traceId:string; runId:string; parentTraceId?:string; name:string; status:TraceStatus; timestamp:number; durationMs?:number; attributes?:Record<string,string|number|boolean>; }
export interface TraceSink { append(event:TraceEvent):Promise<Result<void>>; list(filter?:{runId?:string;traceId?:string;limit?:number}):Promise<Result<TraceEvent[]>>; }
const safeAttributes=(input:TraceEvent["attributes"]):TraceEvent["attributes"]=>{
 if(!input)return undefined;const output:NonNullable<TraceEvent["attributes"]>={};
 for(const [key,value] of Object.entries(input)){if(/key|token|secret|password|authorization|content|prompt/i.test(key))continue;if(key.length<=60&&(typeof value==="string"?value.length<=200:typeof value==="number"||typeof value==="boolean"))output[key]=value;}
 return output;
};
export class InMemoryTraceSink implements TraceSink {
 private readonly events:TraceEvent[]=[];
 constructor(private readonly capacity=5000){}
 async append(event:TraceEvent):Promise<Result<void>>{
  if(!event.traceId.trim()||!event.runId.trim()||!event.name.trim()||!Number.isFinite(event.timestamp))return err("validation","Trace event is invalid.");
  this.events.push({...event,attributes:safeAttributes(event.attributes)});if(this.events.length>this.capacity)this.events.splice(0,this.events.length-this.capacity);return ok(undefined);
 }
 async list(filter:{runId?:string;traceId?:string;limit?:number}={}):Promise<Result<TraceEvent[]>>{
  const limit=filter.limit??200;if(!Number.isInteger(limit)||limit<1||limit>1000)return err("validation","Trace limit must be between 1 and 1,000.");
  return ok(this.events.filter(e=>(!filter.runId||e.runId===filter.runId)&&(!filter.traceId||e.traceId===filter.traceId)).slice(-limit).map(e=>({...e,attributes:e.attributes?{...e.attributes}:undefined})));
 }
}
export class TracedOperation {
 private readonly startedAt:number;
 constructor(private readonly sink:TraceSink,private readonly clock:{now():number},private readonly event:Omit<TraceEvent,"timestamp"|"status"|"durationMs">){this.startedAt=clock.now();}
 async start():Promise<Result<void>>{return this.write("started");}
 async progress(attributes?:TraceEvent["attributes"]):Promise<Result<void>>{return this.write("progress",attributes);}
 async finish(status:"completed"|"failed"|"cancelled"|"waiting_for_approval",attributes?:TraceEvent["attributes"]):Promise<Result<void>>{return this.write(status,attributes);}
 private write(status:TraceStatus,attributes?:TraceEvent["attributes"]):Promise<Result<void>>{const now=this.clock.now();return this.sink.append({...this.event,status,timestamp:now,...(status==="completed"||status==="failed"||status==="cancelled"?{durationMs:Math.max(0,now-this.startedAt)}:{}),...(attributes?{attributes}:{})});}
}
