import type { ProjectId, ProjectRepository, WorkspaceProject } from "../core/projects";
import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";
import { invoke } from "@tauri-apps/api/core";
const KEY="nexus-au:projects:v1";
function valid(value:unknown):value is WorkspaceProject { if(!value||typeof value!=="object")return false;const p=value as Partial<WorkspaceProject>;return typeof p.id==="string"&&typeof p.name==="string"&&typeof p.description==="string"&&typeof p.createdAt==="number"&&typeof p.updatedAt==="number"&&typeof p.archived==="boolean"&&p.schemaVersion===1; }
export class LocalStorageProjectRepository implements ProjectRepository {
 constructor(private readonly storage:StorageLike,private readonly key=KEY){}
 async list(includeArchived:boolean):Promise<Result<WorkspaceProject[]>>{const all=this.read();return all.ok?ok(all.value.filter(p=>includeArchived||!p.archived).sort((a,b)=>b.updatedAt-a.updatedAt)):all;}
 async save(project:WorkspaceProject):Promise<Result<void>>{const all=this.read();if(!all.ok)return all;try{this.storage.setItem(this.key,JSON.stringify([...all.value.filter(p=>p.id!==project.id),project]));return ok(undefined);}catch{return err("storage_failed","Could not save project.",true);}}
 async delete(id:ProjectId):Promise<Result<void>>{const all=this.read();if(!all.ok)return all;try{this.storage.setItem(this.key,JSON.stringify(all.value.filter(p=>p.id!==id)));return ok(undefined);}catch{return err("storage_failed","Could not delete project.",true);}}
 private read():Result<WorkspaceProject[]>{try{const raw=this.storage.getItem(this.key);if(!raw)return ok([]);const data:unknown=JSON.parse(raw);return Array.isArray(data)&&data.every(valid)?ok(data):err("storage_failed","Project storage contains invalid data.");}catch{return err("storage_failed","Could not read projects.",true);}}
}


function isNativeDesktop(): boolean {
 return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export class WorkspaceProjectRepository implements ProjectRepository {
 private readonly local: LocalStorageProjectRepository;
 constructor(storage: StorageLike) { this.local = new LocalStorageProjectRepository(storage); }

 async list(includeArchived: boolean): Promise<Result<WorkspaceProject[]>> {
  if (!isNativeDesktop()) return this.local.list(includeArchived);
  try {
   let projects = await invoke<WorkspaceProject[]>("load_projects");
   if (projects.length === 0) {
    const legacy = await this.local.list(true);
    if (!legacy.ok) return legacy;
    for (const project of legacy.value) await invoke("save_project", { project });
    projects = legacy.value;
   }
   return ok(projects.filter(project => includeArchived || !project.archived).sort((a,b) => b.updatedAt-a.updatedAt));
  } catch (error) {
   return err("storage_failed", error instanceof Error ? error.message : "Could not load native projects.", true);
  }
 }

 async save(project: WorkspaceProject): Promise<Result<void>> {
  if (!isNativeDesktop()) return this.local.save(project);
  try { await invoke("save_project", { project }); return ok(undefined); }
  catch (error) { return err("storage_failed", error instanceof Error ? error.message : "Could not save native project.", true); }
 }

 async delete(id: ProjectId): Promise<Result<void>> {
  if (!isNativeDesktop()) return this.local.delete(id);
  try { await invoke("delete_project", { id }); return ok(undefined); }
  catch (error) { return err("storage_failed", error instanceof Error ? error.message : "Could not delete native project.", true); }
 }
}
