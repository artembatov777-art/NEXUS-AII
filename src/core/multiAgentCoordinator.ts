import type { Result } from "./result";
import type { AgentId, AgentRunId } from "./agents";
import type { AgentPlan, AgentPlanStep } from "./agentPlanner";
import type { TraceSink } from "./observability";
export interface AgentTaskExecutor { execute(agentId:AgentId,input:unknown,signal:AbortSignal):Promise<Result<unknown>>; }
export interface CoordinatorPolicy { authorize(agentId:AgentId,reason:string):Promise<"allow"|"deny"|"ask_user">; }
export type CoordinationEvent={type:"started"|"agent_started"|"agent_completed"|"waiting_for_approval"|"completed"|"failed";runId:AgentRunId;agentId?:AgentId;step?:number;detail?:string};
interface PendingCoordination { plan:AgentPlan; assignments:Record<string,AgentId>; nextIndex:number; outputs:Map<string,unknown>; }
export class MultiAgentCoordinator {
 private readonly pending=new Map<AgentRunId,PendingCoordination>();
 constructor(private readonly executor:AgentTaskExecutor,private readonly policy:CoordinatorPolicy,private readonly traces:TraceSink,private readonly clock:{now():number},private readonly maxAgents=4){}
 async *run(runId:AgentRunId,plan:AgentPlan,assignments:Record<string,AgentId>,signal:AbortSignal):AsyncIterable<CoordinationEvent>{
  if(this.pending.has(runId)){yield {type:"failed",runId,detail:"A coordination with this run ID is already waiting for approval."};return;}
  if(!plan||!Array.isArray(plan.steps)||plan.steps.length===0||plan.steps.length>this.maxAgents){yield {type:"failed",runId,detail:"Coordination plan is empty or exceeds the agent budget."};return;}
  const outputs=new Map<string,unknown>();yield {type:"started",runId};
  await this.trace(runId,"started");
  yield* this.executeFrom(runId,plan,assignments,0,outputs,signal);
 }
 /** Continues from the first unexecuted step after the host has granted the requested permission. */
 async *resume(runId:AgentRunId,signal:AbortSignal):AsyncIterable<CoordinationEvent>{
  const pending=this.pending.get(runId);if(!pending){yield {type:"failed",runId,detail:"No pending coordination is available to resume."};return;}
  this.pending.delete(runId);
  if(signal.aborted){await this.trace(runId,"cancelled");yield {type:"failed",runId,detail:"Coordination was cancelled."};return;}
  yield* this.executeFrom(runId,pending.plan,pending.assignments,pending.nextIndex,pending.outputs,signal);
 }
 private async *executeFrom(runId:AgentRunId,plan:AgentPlan,assignments:Record<string,AgentId>,start:number,outputs:Map<string,unknown>,signal:AbortSignal):AsyncIterable<CoordinationEvent>{
  for(let index=start;index<plan.steps.length;index++){
   const step:AgentPlanStep=plan.steps[index],agentId=assignments[step.id];
   if(signal.aborted){await this.trace(runId,"cancelled",{step:index+1});yield {type:"failed",runId,detail:"Coordination cancelled."};return;}
   if(!agentId){await this.trace(runId,"failed",{step:index+1});yield {type:"failed",runId,detail:`No agent assigned to step ${step.id}.`};return;}
   if(step.dependsOn.some(dep=>!outputs.has(dep))){await this.trace(runId,"failed",{step:index+1});yield {type:"failed",runId,detail:"A dependency has no completed result."};return;}
   let decision:"allow"|"deny"|"ask_user";try{decision=await this.policy.authorize(agentId,`Execute delegated plan step: ${step.purpose}`);}catch{decision="deny";}
   if(decision==="ask_user"){
    this.pending.set(runId,{plan,assignments,nextIndex:index,outputs});
    await this.trace(runId,"waiting_for_approval",{step:index+1});
    yield {type:"waiting_for_approval",runId,agentId,step:index+1,detail:"Explicit host approval is required before this agent starts."};return;
   }
   if(decision==="deny"){await this.trace(runId,"failed",{step:index+1});yield {type:"failed",runId,agentId,step:index+1,detail:"Agent delegation was denied."};return;}
   yield {type:"agent_started",runId,agentId,step:index+1};await this.trace(runId,"progress",{step:index+1});
   const input={...((step.input&&typeof step.input==="object"&&!Array.isArray(step.input))?step.input as Record<string,unknown>:{value:step.input}),dependencyResults:Object.fromEntries(step.dependsOn.map(dep=>[dep,outputs.get(dep)])),goal:plan.goal,purpose:step.purpose};
   const result=await this.executor.execute(agentId,input,signal);
   if(!result.ok){await this.trace(runId,"failed",{step:index+1});yield {type:"failed",runId,agentId,step:index+1,detail:result.error.message};return;}
   outputs.set(step.id,result.value);yield {type:"agent_completed",runId,agentId,step:index+1};
  }
  await this.trace(runId,"completed",{agents:plan.steps.length});yield {type:"completed",runId,detail:`Completed ${outputs.size} delegated steps.`};
 }
 private async trace(runId:AgentRunId,status:"started"|"progress"|"waiting_for_approval"|"completed"|"failed"|"cancelled",attributes?:Record<string,string|number|boolean>):Promise<void>{
  await this.traces.append({traceId:`coord:${runId}`,runId,name:"multi_agent.coordination",status,timestamp:this.clock.now(),...(status==="completed"||status==="failed"||status==="cancelled"?{durationMs:0}:{}),attributes});
 }
}
