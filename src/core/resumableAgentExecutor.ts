import { err, ok, type Result } from "./result";
import type { AgentId, AgentRunId } from "./agents";
import type { ResumableAgentRuntime, ResumableAgentEvent } from "./resumableAgents";
import type { AgentTaskExecutor } from "./multiAgentCoordinator";

/** Adapts the checkpointed agent runtime to the coordinator. It never bypasses the runtime's permission checks. */
export class ResumableAgentTaskExecutor implements AgentTaskExecutor {
 constructor(private readonly runtime:ResumableAgentRuntime,private readonly threadId:string){}
 async execute(agentId:AgentId,input:unknown,signal:AbortSignal):Promise<Result<unknown>>{
  let runId:AgentRunId|undefined;const output:string[]=[];let completed=false;
  try{
   for await(const event of this.runtime.start(agentId,input,this.threadId,signal)){
    if(event.type==="started")runId=event.runId;
    if(event.type==="output")output.push(event.content);
    if(event.type==="waiting_for_approval")return err("permission_denied",`Delegated agent requires approval: ${event.permission}`);
    if(event.type==="failed")return err("tool_failed",event.message);
    if(event.type==="completed")completed=true;
   }
  }catch(cause){return err(signal.aborted?"cancelled":"tool_failed",cause instanceof Error?cause.message:"Delegated agent failed.");}
  if(signal.aborted)return err("cancelled","Delegated agent was cancelled.");
  if(!completed)return err("tool_failed",runId?"Delegated agent ended without completion.":"Delegated agent did not start.");
  return ok({runId,output:output.join("\n")});
 }
}
