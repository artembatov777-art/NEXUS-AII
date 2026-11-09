import {useEffect,useMemo,useState} from "react";
import {Archive,FolderKanban,Plus,X} from "lucide-react";
import {ProjectService,type ProjectId,type WorkspaceProject} from "../core/projects";
import {WorkspaceProjectRepository} from "../lib/projectStorage";
export function ProjectPanel({onClose}:{onClose:()=>void}){
 const service=useMemo(()=>new ProjectService(new WorkspaceProjectRepository(window.localStorage),()=>crypto.randomUUID() as ProjectId,()=>Date.now()),[]);
 const [projects,setProjects]=useState<WorkspaceProject[]>([]),[name,setName]=useState(""),[description,setDescription]=useState(""),[error,setError]=useState("");
 async function refresh(){const r=await service.list();if(r.ok){setProjects(r.value);setError("");}else setError(r.error.message);}
 useEffect(()=>{void refresh();},[]);
 async function create(){const r=await service.create(name,description);if(!r.ok){setError(r.error.message);return;}setName("");setDescription("");await refresh();}
 async function archive(id:ProjectId){const r=await service.archive(id);if(!r.ok)setError(r.error.message);else await refresh();}
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="project-title">
 <header className="memory-header"><div><div className="eyebrow">WORKSPACE ORGANIZATION</div><h2 id="project-title"><FolderKanban size={21}/> Projects</h2><p>Keep project context separate and ready for knowledge retrieval.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close projects"><X size={18}/></button></header>
 <div className="project-create"><input value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="Project name"/><textarea value={description} maxLength={500} onChange={e=>setDescription(e.target.value)} rows={2} placeholder="What is this project about?"/><button className="primary-btn" disabled={!name.trim()} onClick={()=>void create()}><Plus size={14}/> Create project</button></div>
 {error&&<div className="error-banner">{error}</div>}<div className="project-list">{projects.map(p=><article className="project-item" key={p.id}><div><strong>{p.name}</strong><p>{p.description||"No description yet."}</p><small>Updated {new Date(p.updatedAt).toLocaleString()}</small></div><button className="icon-btn" onClick={()=>void archive(p.id)} aria-label={"Archive "+p.name}><Archive size={15}/></button></article>)}{projects.length===0&&<div className="memory-empty">No projects yet. Create one to organize related knowledge.</div>}</div>
 <footer className="project-footnote">Project metadata and conversation ownership are stored in the native workspace database when running the desktop app.</footer>
 </section></div>;
}
