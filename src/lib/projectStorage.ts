import type { ProjectId, ProjectRepository, WorkspaceProject } from "../core/projects";
import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";
const KEY="nexus-au:projects:v1";
function valid(value:unknown):value is WorkspaceProject { if(!value||typeof value!=="object")return false;const p=value as Partial<WorkspaceProject>;return typeof p.id==="string"&&typeof p.name==="string"&&typeof p.description==="string"&&typeof p.createdAt==="number"&&typeof p.updatedAt==="number"&&typeof p.archived==="boolean"&&p.schemaVersion===1; }
export class LocalStorageProjectRepository implements ProjectRepository {
 constructor(private readonly storage:StorageLike,private readonly key=KEY){}
 async list(includeArchived:boolean):Promise<Result<WorkspaceProject[]>>{const all=this.read();return all.ok?ok(all.value.filter(p=>includeArchived||!p.archived).sort((a,b)=>b.updatedAt-a.updatedAt)):all;}
 async save(project:WorkspaceProject):Promise<Result<void>>{const all=this.read();if(!all.ok)return all;try{this.storage.setItem(this.key,JSON.stringify([...all.value.filter(p=>p.id!==project.id),project]));return ok(undefined);}catch{return err("storage_failed","Could not save project.",true);}}
 async delete(id:ProjectId):Promise<Result<void>>{const all=this.read();if(!all.ok)return all;try{this.storage.setItem(this.key,JSON.stringify(all.value.filter(p=>p.id!==id)));return ok(undefined);}catch{return err("storage_failed","Could not delete project.",true);}}
 private read():Result<WorkspaceProject[]>{try{const raw=this.storage.getItem(this.key);if(!raw)return ok([]);const data:unknown=JSON.parse(raw);return Array.isArray(data)&&data.every(valid)?ok(data):err("storage_failed","Project storage contains invalid data.");}catch{return err("storage_failed","Could not read projects.",true);}}
}
