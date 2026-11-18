import { err, ok, type Result } from "./result";
export type ProjectId = string & { readonly __brand: "ProjectId" };
export interface WorkspaceProject { id: ProjectId; name: string; description: string; createdAt: number; updatedAt: number; archived: boolean; schemaVersion: 1; }
export interface ProjectRepository { list(includeArchived: boolean): Promise<Result<WorkspaceProject[]>>; save(project: WorkspaceProject): Promise<Result<void>>; delete(id: ProjectId): Promise<Result<void>>; }
export class ProjectService {
 constructor(private readonly repository: ProjectRepository, private readonly id: () => ProjectId, private readonly now: () => number) {}
 async create(name: string, description = ""): Promise<Result<WorkspaceProject>> {
  const clean=name.trim(), detail=description.trim();
  if(!clean||clean.length>80||detail.length>500)return err("validation","Project name or description is invalid.");
  const at=this.now(), project:WorkspaceProject={id:this.id(),name:clean,description:detail,createdAt:at,updatedAt:at,archived:false,schemaVersion:1};
  const saved=await this.repository.save(project);return saved.ok?ok(project):saved;
 }
 async rename(id:ProjectId,name:string,description:string):Promise<Result<WorkspaceProject>>{
  const all=await this.repository.list(true);if(!all.ok)return all;
  const current=all.value.find(item=>item.id===id);if(!current)return err("validation","Project not found.");
  const clean=name.trim(),detail=description.trim();if(!clean||clean.length>80||detail.length>500)return err("validation","Project name or description is invalid.");
  const next={...current,name:clean,description:detail,updatedAt:this.now()};const saved=await this.repository.save(next);return saved.ok?ok(next):saved;
 }
 async archive(id:ProjectId):Promise<Result<void>>{
  const all=await this.repository.list(true);if(!all.ok)return all;const current=all.value.find(item=>item.id===id);if(!current)return err("validation","Project not found.");
  return this.repository.save({...current,archived:true,updatedAt:this.now()});
 }
 async delete(id:ProjectId):Promise<Result<void>>{
  const all=await this.repository.list(true);if(!all.ok)return all;
  if(!all.value.some(item=>item.id===id))return err("validation","Project not found.");
  return this.repository.delete(id);
 }
 list(includeArchived=false){return this.repository.list(includeArchived);}
}
