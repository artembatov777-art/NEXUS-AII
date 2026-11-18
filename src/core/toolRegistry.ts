import { err, ok, type Result } from "./result";
import type { PermissionScope, ToolDefinition, ToolGateway, ToolRisk } from "./tools";

export interface ToolDescriptor {
  id: string; version: string; description: string; requiredPermissions: PermissionScope[];
  risk: ToolRisk; timeoutMs: number; source: "builtin" | "mcp" | "plugin";
  tags: string[];
}
export class ToolRegistry {
  private readonly descriptors = new Map<string, ToolDescriptor>();
  constructor(private readonly gateway: ToolGateway) {}
  register<Input, Output>(definition: ToolDefinition<Input, Output>, source: ToolDescriptor["source"] = "builtin", tags: string[] = []): Result<ToolDescriptor> {
    if (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 40)) return err("validation", "Tool tags must be non-empty strings up to 40 characters.");
    if (this.descriptors.has(definition.id)) return err("validation", `Tool "${definition.id}" is already registered.`);
    const added = this.gateway.register(definition);
    if (!added.ok) return added;
    const descriptor: ToolDescriptor = { id: definition.id, version: definition.version, description: definition.description,
      requiredPermissions: [...definition.requiredPermissions], risk: definition.risk, timeoutMs: definition.timeoutMs, source, tags: [...new Set(tags)] };
    this.descriptors.set(descriptor.id, descriptor);
    return ok(descriptor);
  }
  unregister(id: string): boolean {
    if (!this.descriptors.has(id)) return false;
    this.gateway.unregister(id); this.descriptors.delete(id); return true;
  }
  get(id: string): ToolDescriptor | null { const item=this.descriptors.get(id); return item ? { ...item, requiredPermissions:[...item.requiredPermissions], tags:[...item.tags] } : null; }
  search(query = "", limit = 50): Result<ToolDescriptor[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return err("validation", "Tool search limit must be between 1 and 200.");
    const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches=[...this.descriptors.values()].filter(item => {
      const haystack=[item.id,item.description,...item.tags].join(" ").toLocaleLowerCase();
      return terms.every(term=>haystack.includes(term));
    }).slice(0,limit).map(item=>({...item,requiredPermissions:[...item.requiredPermissions],tags:[...item.tags]}));
    return ok(matches);
  }
}
