import { err, ok, type Result } from "./result";
import type { AgentId, AgentRunId } from "./agents";
import type { AgentPlan } from "./agentPlanner";
import type { TraceSink } from "./observability";

export interface AgentTaskExecutor { execute(agentId:AgentId,input:unknown,signal:AbortSignal):Promise<Result<unknown>>; }
export interface CoordinatorPolicy { authorize(agentId:AgentId,reason:string):Promise<"allow"|"deny"|"ask_user">; }
export type CoordinationEvent={type:"started"|"agent_started"|"agent_completed"|"completed"|"failed";runId:AgentRunId;agentId?:AgentId;step?:number;detail?:string};
export class MultiAgentCoordinator {
 constructor(private readonly executor:AgentTaskExecutor,private readonly policy:CoordinatorPolicy,private readonly traces:TraceSink,private readonly clock:{now():number},private readonly maxAgents=4){}
 async *run(runId:AgentRunId,plan:AgentPlan,assignments:Record<string,AgentId>,signal:AbortSignal):AsyncIterable<CoordinationEvent>{
  const started=this.clock.now(),traceId=`coord:${runId}`;
  const trace=async(status:"started"|"progress"|"completed"|"failed"|"cancelled",attributes?:Record<string,string|number|boolean>)=>this.traces.append({traceId,runId,name:"multi_agent.coordination",status,timestamp:this.clock.now(),...(status==="completed"||status==="failed"||status==="cancelled"?{durationMs:Math.max(0,this.clock.now()-started)}:{}),attributes});
  if(!plan||!Array.isArray(plan.steps)||plan.steps.length>this.maxAgents||plan.steps.length===0){yield {type:"failed",runId,detail:"Coordination plan is empty or exceeds the agent budget."};return;}
  yield {type:"started",runId};await trace("started");
  const outputs=new Map<string,unknown>();
  for(let index=0;index<plan.steps.length;index++){
   const step=plan.steps[index],agentId=assignments[step.id];
   if(signal.aborted){await trace("cancelled");yield {type:"failed",runId,detail:"Coordination cancelled."};return;}
   if(!agentId){await trace("failed");yield {type:"failed",runId,detail:`No agent assigned to step ${step.id}.`};return;}
   if(step.dependsOn.some(dep=>!outputs.has(dep))){await trace("failed");yield {type:"failed",runId,detail:"A dependency has no completed result."};return;}
   let decision:"allow"|"deny"|"ask_user";try{decision=await this.policy.authorize(agentId,`Execute delegated plan step: ${step.purpose}`);}catch{decision="deny";}
   if(decision!=="allow"){await trace("failed",{step:index+1});yield {type:"failed",runId,agentId,step:index+1,detail:decision==="ask_user"?"Agent approval is required before delegation.":"Agent delegation was denied."};return;}
   yield {type:"agent_started",runId,agentId,step:index+1};await trace("progress",{step:index+1});
   const input={...((step.input&&typeof step.input==="object"&&!Array.isArray(step.input))?step.input as Record<string,unknown>:{value:step.input}),dependencyResults:Object.fromEntries(step.dependsOn.map(dep=>[dep,outputs.get(dep)])),goal:plan.goal,purpose:step.purpose};
   const result=await this.executor.execute(agentId,input,signal);
   if(!result.ok){await trace("failed",{step:index+1});yield {type:"failed",runId,agentId,step:index+1,detail:result.error.message};return;}
   outputs.set(step.id,result.value);yield {type:"agent_completed",runId,agentId,step:index+1};
  }
  await trace("completed",{agents:plan.steps.length});yield {type:"completed",runId,detail:`Completed ${outputs.size} delegated steps.`};
 }
}
