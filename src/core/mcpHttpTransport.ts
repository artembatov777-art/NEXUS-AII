import type { McpRequest, McpResponse, McpTransport } from "./mcpClient";
export interface McpHttpTransportOptions { endpoint:string; fetcher?:typeof fetch; headers?:Record<string,string>; }
export class McpHttpTransport implements McpTransport {
 private readonly endpoint:URL;private readonly fetcher:typeof fetch;private readonly headers:Record<string,string>;
 constructor(options:McpHttpTransportOptions){
  const url=new URL(options.endpoint);
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.hash)throw new Error("MCP endpoint must be an HTTP(S) URL without embedded credentials or fragments.");
  this.endpoint=url;this.fetcher=options.fetcher??fetch;this.headers={...(options.headers??{})};
  for(const key of Object.keys(this.headers))if(/^(host|content-length|cookie|origin)$/i.test(key))throw new Error(`Header "${key}" cannot be overridden.`);
 }
 async request(request:McpRequest,signal:AbortSignal):Promise<McpResponse>{
  const response=await this.fetcher(this.endpoint.toString(),{method:"POST",headers:{"content-type":"application/json","accept":"application/json, text/event-stream",...this.headers},body:JSON.stringify(request),signal,credentials:"omit",redirect:"error",cache:"no-store"});
  if(!response.ok)throw new Error(`MCP HTTP request failed with status ${response.status}.`);
  const type=response.headers.get("content-type")??"";
  if(type.includes("application/json"))return await response.json() as McpResponse;
  if(type.includes("text/event-stream")){
   const body=await response.text();const data=body.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trim()).filter(Boolean).at(-1);
   if(!data)throw new Error("MCP SSE response contained no JSON data event.");return JSON.parse(data) as McpResponse;
  }
  throw new Error("MCP server returned an unsupported content type.");
 }
}
