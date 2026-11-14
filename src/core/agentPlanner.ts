import { err, ok, type Result } from "./result";
import type { ToolDescriptor } from "./toolRegistry";

export interface AgentPlanStep { id:string; toolId:string; purpose:string; input:unknown; dependsOn:string[]; }
export interface AgentPlan { goal:string; steps:AgentPlanStep[]; }
export interface PlannerModel { createPlan(input:{goal:string;tools:ToolDescriptor[];signal:AbortSignal;referenceContext?:string}):Promise<Result<AgentPlan>>; }
export interface ValidatedPlan { goal:string; steps:AgentPlanStep[]; }
export class AgentPlanner {
  constructor(private readonly model:PlannerModel,private readonly maxSteps=12) {}
  async plan(goal:string,tools:ToolDescriptor[],signal:AbortSignal,referenceContext?:string):Promise<Result<ValidatedPlan>> {
    if(!goal.trim()||goal.length>4000)return err("validation","Planner goal must contain 1 to 4,000 characters.");
    if(!Number.isInteger(this.maxSteps)||this.maxSteps<1||this.maxSteps>50)return err("validation","Planner step budget is invalid.");
    if(signal.aborted)return err("cancelled","Planning was cancelled.");
    if(referenceContext!==undefined&&(typeof referenceContext!=="string"||referenceContext.length>12_000))return err("validation","Planner reference context exceeds 12,000 characters.");
    const response=await this.model.createPlan({goal:goal.trim(),tools:tools.map(t=>({...t,requiredPermissions:[...t.requiredPermissions],tags:[...t.tags]})),signal,...(referenceContext?.trim()?{referenceContext:referenceContext.trim()}:{})});
    if(!response.ok)return response;
    const plan=response.value;
    if(!plan||plan.goal!==goal.trim()||!Array.isArray(plan.steps)||plan.steps.length>this.maxSteps)return err("validation","Planner returned an invalid plan or exceeded its step budget.");
    const allowed=new Set(tools.map(t=>t.id)),ids=new Set<string>(),completed=new Set<string>();
    for(const step of plan.steps){
      if(!step||!/^[a-zA-Z0-9_-]{1,64}$/.test(step.id)||ids.has(step.id)||!allowed.has(step.toolId)||!step.purpose?.trim()||step.purpose.length>300||!Array.isArray(step.dependsOn))return err("validation","Plan contains an invalid or unavailable tool step.");
      ids.add(step.id);
      if(step.dependsOn.some(dep=>!completed.has(dep)||dep===step.id))return err("validation","Plan dependencies must reference earlier steps; cycles and forward references are rejected.");
      try{const encoded=JSON.stringify(step.input);if(typeof encoded!=="string"||new TextEncoder().encode(encoded).byteLength>64_000)return err("validation","Plan input exceeds 64 KB or is not JSON serializable.");}catch{return err("validation","Plan input is not JSON serializable.");}
      completed.add(step.id);
    }
    return ok({goal:plan.goal,steps:plan.steps.map(s=>({...s,dependsOn:[...s.dependsOn]}))});
  }
}
