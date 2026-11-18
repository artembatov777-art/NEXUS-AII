import type { ProjectId, ProjectRepository, WorkspaceProject } from "../core/projects";
import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";
import { invoke } from "@tauri-apps/api/core";
const KEY="nexus-au:projects:v1";
function valid(value:unknown):value is WorkspaceProject { if(!value||typeof value!=="object")return false;const p=value as Partial<WorkspaceProject>;return typeof p.id==="string"&&typeof p.name==="string"&&typeof p.description==="string"&&typeof p.createdAt==="number"&&typeof p.updatedAt==="number"&&typeof p.archived==="boolean"&&p.schemaVersion===1; }
export class LocalStorageProjectRepository implements ProjectRepository {
 constructor(private readonly storage:StorageLike,private readonly key=KEY){}
 async list(includeArchived:boolean):Promise<Result<WorkspaceProject[]>>{const all=this.read();return all.ok?ok(all.value.filter(p=>includeArchived||!p.archived).sort((a,b)=>b.updatedAt-a.updatedAt)):all;}
 clearLegacy():void{this.storage.setItem(this.key,"[]");}
 async save(project:WorkspaceProject):Promise<Result<void>>{const all=this.read();if(!all.ok)return all;try{this.storage.setItem(this.key,JSON.stringify([...all.value.filter(p=>p.id!==project.id),project]));return ok(undefined);}catch{return err("storage_failed","Could not save project.",true);}}
 async delete(id:ProjectId):Promise<Result<void>>{const all=this.read();if(!all.ok)return all;try{this.storage.setItem(this.key,JSON.stringify(all.value.filter(p=>p.id!==id)));return ok(undefined);}catch{return err("storage_failed","Could not delete project.",true);}}
 private read():Result<WorkspaceProject[]>{try{const raw=this.storage.getItem(this.key);if(!raw)return ok([]);const data:unknown=JSON.parse(raw);return Array.isArray(data)&&data.every(valid)?ok(data):err("storage_failed","Project storage contains invalid data.");}catch{return err("storage_failed","Could not read projects.",true);}}
}


function isNativeDesktop(): boolean {
 return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const projectMigrations = new WeakMap<StorageLike, Promise<void>>();

export class WorkspaceProjectRepository implements ProjectRepository {
 private readonly local: LocalStorageProjectRepository;
 private migration?: Promise<void>;

 constructor(private readonly storage: StorageLike) {
  this.local = new LocalStorageProjectRepository(storage);
 }

 /** Coordinate one legacy import across every panel/service sharing this storage. */
 private async ensureMigrated(): Promise<void> {
  if (!isNativeDesktop()) return;
  if (!this.migration) {
   let pending = projectMigrations.get(this.storage);
   if (!pending) {
    pending = (async () => {
     const native = await invoke<WorkspaceProject[]>("load_projects");
     const legacy = await this.local.list(true);
     if (!legacy.ok) throw new Error(legacy.error.message);
     const existing = new Set(native.map(project => project.id));
     for (const project of legacy.value) {
      if (!existing.has(project.id)) await invoke("save_project", { project });
     }
     // Clear only after all imports succeed; otherwise the next call can retry.
     this.local.clearLegacy();
    })();
    projectMigrations.set(this.storage, pending);
    void pending.catch(() => {
     if (projectMigrations.get(this.storage) === pending) projectMigrations.delete(this.storage);
    });
   }
   this.migration = pending.catch(error => {
    this.migration = undefined;
    throw error;
   });
  }
  await this.migration;
 }

 private async all(): Promise<WorkspaceProject[]> {
  if (!isNativeDesktop()) {
   const local = await this.local.list(true);
   if (!local.ok) throw new Error(local.error.message);
   return local.value;
  }
  await this.ensureMigrated();
  // Read the live native snapshot after migration; never cache mutable records.
  return invoke<WorkspaceProject[]>("load_projects");
 }

 async list(includeArchived: boolean): Promise<Result<WorkspaceProject[]>> {
  try {
   const projects = await this.all();
   return ok(projects.filter(project => includeArchived || !project.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt));
  } catch (error) {
   return err("storage_failed", error instanceof Error ? error.message : "Could not load native projects.", true);
  }
 }

 async save(project: WorkspaceProject): Promise<Result<void>> {
  if (!isNativeDesktop()) return this.local.save(project);
  try {
   await this.ensureMigrated();
   await invoke("save_project", { project });
   return ok(undefined);
  } catch (error) {
   return err("storage_failed", error instanceof Error ? error.message : "Could not save native project.", true);
  }
 }

 async delete(id: ProjectId): Promise<Result<void>> {
  if (!isNativeDesktop()) return this.local.delete(id);
  try {
   await this.ensureMigrated();
   await invoke("delete_project", { id });
   return ok(undefined);
  } catch (error) {
   return err("storage_failed", error instanceof Error ? error.message : "Could not delete native project.", true);
  }
 }
}
