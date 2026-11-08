import { err, ok, type Result } from "./result";
import type { McpRemoteTool, McpToolAdapter } from "./mcpClient";
/** Deliberately bounded JSON-Schema subset. Unsupported keywords fail closed instead of silently accepting inputs. */
export class BasicMcpSchemaAdapter implements McpToolAdapter {
 validate(_serverId:string,tool:McpRemoteTool,input:unknown):Result<unknown>{
  const schema=tool.inputSchema;
  if(!schema||typeof schema!=="object"||Array.isArray(schema))return err("validation","MCP tool has no valid input schema.");
  const root=schema as Record<string,unknown>;
  const supported=new Set(["type","properties","required","additionalProperties","description","title"]);
  if(Object.keys(root).some(key=>!supported.has(key)))return err("validation","MCP input schema uses unsupported keywords.");
  if(root.type!=="object"||!root.properties||typeof root.properties!=="object"||Array.isArray(root.properties))return err("validation","Only object-shaped MCP input schemas are supported.");
  if(!input||typeof input!=="object"||Array.isArray(input))return err("validation","MCP tool input must be an object.");
  const value=input as Record<string,unknown>,properties=root.properties as Record<string,unknown>,required=Array.isArray(root.required)?root.required:[];
  if(required.some(key=>typeof key!=="string"||!(key in value)))return err("validation","MCP tool input is missing a required property.");
  if(root.additionalProperties===false&&Object.keys(value).some(key=>!(key in properties)))return err("validation","MCP tool input contains an unknown property.");
  for(const [key,field] of Object.entries(properties)){
   if(!(key in value)||!field||typeof field!=="object")continue;const type=(field as Record<string,unknown>).type,v=value[key];
   const valid=type==="string"?typeof v==="string":type==="number"?typeof v==="number"&&Number.isFinite(v):type==="integer"?Number.isSafeInteger(v):type==="boolean"?typeof v==="boolean":type==="array"?Array.isArray(v):type==="object"?!!v&&typeof v==="object"&&!Array.isArray(v):false;
   if(!valid)return err("validation",`MCP property "${key}" has an invalid or unsupported type.`);
  }
  return ok(value);
 }
}
