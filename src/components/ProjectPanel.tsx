import {useEffect,useMemo,useState} from "react";
import {Archive,FolderKanban,Plus,Trash2,X} from "lucide-react";
import {isTauri} from "@tauri-apps/api/core";
import {IndexedDbKnowledgeVectorIndex} from "../lib/knowledgeVectorIndex";
import {ProjectService,type ProjectId,type WorkspaceProject} from "../core/projects";
import {WorkspaceProjectRepository} from "../lib/projectStorage";
export function ProjectPanel({onClose,onDeleted}:{onClose:()=>void;onDeleted?:()=>void|Promise<void>}){
 const service=useMemo(()=>new ProjectService(new WorkspaceProjectRepository(window.localStorage),()=>crypto.randomUUID() as ProjectId,()=>Date.now()),[]);
 const vectors=useMemo(()=>new IndexedDbKnowledgeVectorIndex(),[]);
 const nativeDesktop=isTauri();
 const [projects,setProjects]=useState<WorkspaceProject[]>([]),[name,setName]=useState(""),[description,setDescription]=useState(""),[error,setError]=useState("");
 async function refresh(){const r=await service.list();if(r.ok){setProjects(r.value);setError("");}else setError(r.error.message);}
 useEffect(()=>{void refresh();},[]);
 async function create(){const r=await service.create(name,description);if(!r.ok){setError(r.error.message);return;}setName("");setDescription("");await refresh();}
 async function archive(id:ProjectId){const r=await service.archive(id);if(!r.ok)setError(r.error.message);else await refresh();}
 async function remove(id:ProjectId,projectName:string){
  if(!nativeDesktop)return;
  if(!window.confirm("Permanently delete project \""+projectName+"\" and its conversations, memories, documents and semantic vectors? This cannot be undone. Export a workspace backup first if you need to keep the data."))return;
  const result=await service.delete(id);
  if(!result.ok){setError(result.error.message);return;}
  try{await vectors.removeProject(id);}catch{setError("Project data was deleted, but stale semantic vectors could not be cleared. They will be excluded from project retrieval.");}
  await refresh();
  await onDeleted?.();
 }
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="project-title">
 <header className="memory-header"><div><div className="eyebrow">WORKSPACE ORGANIZATION</div><h2 id="project-title"><FolderKanban size={21}/> Projects</h2><p>Keep project context separate and ready for knowledge retrieval.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close projects"><X size={18}/></button></header>
 <div className="project-create"><input aria-label="Project name" value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="Project name"/><textarea aria-label="Project description" value={description} maxLength={500} onChange={e=>setDescription(e.target.value)} rows={2} placeholder="What is this project about?"/><button className="primary-btn" disabled={!name.trim()} onClick={()=>void create()}><Plus size={14}/> Create project</button></div>
 {error&&<div className="error-banner">{error}</div>}<div className="project-list">{projects.map(p=><article className="project-item" key={p.id}><div><strong>{p.name}</strong><p>{p.description||"No description yet."}</p><small>Updated {new Date(p.updatedAt).toLocaleString()}</small></div><div className="project-actions"><button className="icon-btn" onClick={()=>void archive(p.id)} aria-label={"Archive "+p.name}><Archive size={15}/></button>{nativeDesktop&&<button className="icon-btn" onClick={()=>void remove(p.id,p.name)} aria-label={"Delete "+p.name}><Trash2 size={15}/></button>}</div></article>)}{projects.length===0&&<div className="memory-empty">No projects yet. Create one to organize related knowledge.</div>}</div>
 <footer className="project-footnote">Project metadata and conversation ownership are stored in the native workspace database when running the desktop app.</footer>
 </section></div>;
}
