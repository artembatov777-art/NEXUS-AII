import { BasicMcpSchemaAdapter } from "./mcpSchemaAdapter";
import { err, ok, type Result } from "./result";
import type { PermissionScope, ToolDefinition, ToolGateway, ToolRisk } from "./tools";
import type { ToolRegistry } from "./toolRegistry";
export interface McpRequest { jsonrpc:"2.0"; id:number; method:string; params?:unknown; }
export interface McpResponse { jsonrpc:"2.0"; id:number; result?:unknown; error?:{code:number;message:string}; }
export interface McpTransport { request(request:McpRequest,signal:AbortSignal):Promise<McpResponse>; close?():Promise<void>; }
export interface McpServerConfig { id:string; name:string; version:string; transport:McpTransport; }
export interface McpRemoteTool { name:string; description?:string; inputSchema?:unknown; }
export interface McpToolAdapter { validate(serverId:string,tool:McpRemoteTool,input:unknown):Result<unknown>; }
export interface McpImportedToolOptions { permissions:PermissionScope[]; risk:ToolRisk; timeoutMs:number; adapter?:McpToolAdapter; }
const validId=(value:string)=>/^[a-zA-Z0-9._-]{1,80}$/.test(value);
export class McpClient {
 private sequence=0; private readonly servers=new Map<string,McpServerConfig>();
 constructor(private readonly registry:ToolRegistry,gateway:ToolGateway){void gateway;}
 async connect(config:McpServerConfig,signal:AbortSignal):Promise<Result<{serverId:string;protocolVersion:string}>>{
  if(!validId(config.id)||!config.name.trim()||!config.version.trim()||this.servers.has(config.id))return err("validation","MCP server identity is invalid or already connected.");
  const response=await this.rpc(config,"initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"NEXUS AU",version:"0.1"}},signal);
  if(!response.ok)return response;const result=response.value as {protocolVersion?:unknown};
  if(typeof result?.protocolVersion!=="string")return err("tool_failed","MCP initialize response is malformed.");
  this.servers.set(config.id,config);return ok({serverId:config.id,protocolVersion:result.protocolVersion});
 }
 async listTools(serverId:string,signal:AbortSignal):Promise<Result<McpRemoteTool[]>>{
  const server=this.servers.get(serverId);if(!server)return err("validation","MCP server is not connected.");
  const response=await this.rpc(server,"tools/list",{},signal);if(!response.ok)return response;
  const tools=(response.value as {tools?:unknown})?.tools;if(!Array.isArray(tools)||tools.length>200)return err("tool_failed","MCP tools/list response is invalid or too large.");
  const valid=tools.filter((item):item is McpRemoteTool=>!!item&&typeof item==="object"&&typeof (item as McpRemoteTool).name==="string"&&validId((item as McpRemoteTool).name));
  if(valid.length!==tools.length)return err("tool_failed","MCP server returned an invalid tool name.");return ok(valid);
 }
 importTool(serverId:string,tool:McpRemoteTool,options:McpImportedToolOptions):Result<void>{
  if(!this.servers.has(serverId)||!validId(tool.name))return err("validation","MCP server or tool is invalid.");
  const id=`mcp.${serverId}.${tool.name}`;
  const adapter=options.adapter??new BasicMcpSchemaAdapter();
  const definition:ToolDefinition<unknown,unknown>={id,version:"mcp-1",description:(tool.description||`MCP tool ${tool.name}`).slice(0,500),requiredPermissions:[...options.permissions],risk:options.risk,timeoutMs:options.timeoutMs,
   validateInput:input=>adapter.validate(serverId,tool,input),
   execute:async(input,context)=>{const server=this.servers.get(serverId);if(!server)return err("provider_unavailable","MCP server disconnected.");
    const response=await this.rpc(server,"tools/call",{name:tool.name,arguments:input},context.signal);if(!response.ok)return response;
    const payload=response.value as {isError?:unknown};if(payload?.isError===true)return err("tool_failed","MCP tool reported an execution error.");return ok(payload);}
  };
  const registered=this.registry.register(definition,"mcp",["mcp",serverId]);return registered.ok?ok(undefined):registered;
 }
 async discoverAndImport(serverId:string,signal:AbortSignal,defaults:{permissions:PermissionScope[];risk:ToolRisk;timeoutMs:number}):Promise<Result<{discovered:number;imported:string[];rejected:Array<{name:string;reason:string}>}>>{
  const listed=await this.listTools(serverId,signal);if(!listed.ok)return listed;
  const imported:string[]=[],rejected:Array<{name:string;reason:string}>=[];
  for(const tool of listed.value){const result=this.importTool(serverId,tool,{...defaults});if(result.ok)imported.push(tool.name);else rejected.push({name:tool.name,reason:result.error.message});}
  return ok({discovered:listed.value.length,imported,rejected});
 }
 async disconnect(serverId:string):Promise<void>{const server=this.servers.get(serverId);if(!server)return;this.servers.delete(serverId);await server.transport.close?.();}
 private async rpc(server:McpServerConfig,method:string,params:unknown,signal:AbortSignal):Promise<Result<unknown>>{
  if(signal.aborted)return err("cancelled","MCP request was cancelled.");const id=++this.sequence;
  try{const response=await server.transport.request({jsonrpc:"2.0",id,method,params},signal);
   if(response.jsonrpc!=="2.0"||response.id!==id)return err("tool_failed","MCP response correlation failed.");
   if(response.error)return err("tool_failed",`MCP error ${response.error.code}: ${response.error.message.slice(0,300)}`);
   if(!("result" in response))return err("tool_failed","MCP response has no result.");return ok(response.result);
  }catch(cause){return err(signal.aborted?"cancelled":"provider_unavailable",cause instanceof Error?cause.message:"MCP transport failed.");}
 }
}
