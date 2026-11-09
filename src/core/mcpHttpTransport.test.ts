import {describe,it,expect,vi} from "vitest";
import {McpHttpTransport} from "./mcpHttpTransport";
describe("McpHttpTransport",()=>{
 it("posts JSON-RPC with credentials omitted and parses JSON response",async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:{ok:true}}),{status:200,headers:{"content-type":"application/json"}}));
  const transport=new McpHttpTransport({endpoint:"https://mcp.example/tools",fetcher});
  const result=await transport.request({jsonrpc:"2.0",id:1,method:"initialize"},new AbortController().signal);
  expect(result.result).toEqual({ok:true});
  expect(fetcher).toHaveBeenCalledWith("https://mcp.example/tools",expect.objectContaining({credentials:"omit",redirect:"error"}));
 });
 it("rejects URLs with embedded credentials",()=>{expect(()=>new McpHttpTransport({endpoint:"https://user:pass@example.com"})).toThrow();});
 it("rejects an oversized declared response before reading its body",async()=>{
  const fetcher=vi.fn(async()=>new Response("{}",{status:200,headers:{"content-type":"application/json","content-length":"2000001"}}));
  const transport=new McpHttpTransport({endpoint:"https://mcp.example/tools",fetcher});
  await expect(transport.request({jsonrpc:"2.0",id:1,method:"initialize"},new AbortController().signal)).rejects.toThrow(/2 MB/);
 });
 it("bounds streamed responses even when content-length is missing",async()=>{
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(1_500_000));controller.enqueue(new Uint8Array(600_001));controller.close();}});
  const fetcher=vi.fn(async()=>new Response(body,{status:200,headers:{"content-type":"application/json"}}));
  const transport=new McpHttpTransport({endpoint:"https://mcp.example/tools",fetcher});
  await expect(transport.request({jsonrpc:"2.0",id:1,method:"initialize"},new AbortController().signal)).rejects.toThrow(/2 MB/);
 });
});
