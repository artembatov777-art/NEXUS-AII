import {describe,it,expect,vi} from "vitest";
import {MultiAgentCoordinator} from "./multiAgentCoordinator";
import {InMemoryTraceSink} from "./observability";
import {ok} from "./result";
import type {AgentId,AgentRunId} from "./agents";
describe("MultiAgentCoordinator",()=>{it("runs delegated steps in dependency order with explicit authorization",async()=>{const execute=vi.fn(async(_id:AgentId,input:unknown)=>ok({input}));const policy={authorize:vi.fn(async()=>"allow" as const)};const coordinator=new MultiAgentCoordinator({execute},policy,new InMemoryTraceSink(),{now:()=>10});const events=[];for await(const e of coordinator.run("r" as AgentRunId,{goal:"work",steps:[{id:"a",toolId:"x",purpose:"first",input:{n:1},dependsOn:[]},{id:"b",toolId:"y",purpose:"second",input:{n:2},dependsOn:["a"]}]},{a:"agent-a" as AgentId,b:"agent-b" as AgentId},new AbortController().signal))events.push(e);expect(events[events.length-1]?.type).toBe("completed");expect(execute).toHaveBeenCalledTimes(2);expect(policy.authorize).toHaveBeenCalledTimes(2);});it("pauses for approval and resumes without replaying completed steps",async()=>{let allowed=false;const execute=vi.fn(async()=>ok({done:true}));const coordinator=new MultiAgentCoordinator({execute},{authorize:async() => allowed ? "allow" : "ask_user"},new InMemoryTraceSink(),{now:()=>1});const plan={goal:"work",steps:[{id:"a",toolId:"x",purpose:"task",input:{},dependsOn:[]}]};const assignments={a:"agent-a" as AgentId};const first=[];for await(const e of coordinator.run("r" as AgentRunId,plan,assignments,new AbortController().signal))first.push(e);expect(first[first.length-1].type).toBe("waiting_for_approval");expect(execute).not.toHaveBeenCalled();allowed=true;const resumed=[];for await(const e of coordinator.resume("r" as AgentRunId,new AbortController().signal))resumed.push(e);expect(resumed[resumed.length-1].type).toBe("completed");expect(execute).toHaveBeenCalledTimes(1);});
it("rejects forward dependencies and duplicate step IDs before executing",async()=>{
 const execute=vi.fn(async()=>ok({}));
 const coordinator=new MultiAgentCoordinator({execute},{authorize:async()=>"allow"},new InMemoryTraceSink(),{now:()=>1});
 const forward={goal:"work",steps:[{id:"a",toolId:"x",purpose:"first",input:{},dependsOn:["b"]},{id:"b",toolId:"y",purpose:"second",input:{},dependsOn:[]}]};
 const events=[];for await(const e of coordinator.run("bad" as AgentRunId,forward,{a:"agent-a" as AgentId,b:"agent-b" as AgentId},new AbortController().signal))events.push(e);
 expect(events.at(-1)?.type).toBe("failed");expect(execute).not.toHaveBeenCalled();
});
it("requires an exact assignment for every step",async()=>{
 const execute=vi.fn(async()=>ok({}));
 const coordinator=new MultiAgentCoordinator({execute},{authorize:async()=>"allow"},new InMemoryTraceSink(),{now:()=>1});
 const plan={goal:"work",steps:[{id:"a",toolId:"x",purpose:"task",input:{},dependsOn:[]}]};
 const events=[];for await(const e of coordinator.run("missing" as AgentRunId,plan,{},new AbortController().signal))events.push(e);
 expect(events.at(-1)?.type).toBe("failed");expect(execute).not.toHaveBeenCalled();
});
});
