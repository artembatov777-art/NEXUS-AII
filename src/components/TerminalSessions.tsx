import { Plus, X } from "lucide-react";

type Session = { id: string; title: string };

/** Closing a tab hides it; conversation history remains available in the sidebar. */
export function TerminalSessions({ sessions, activeId, onSelect, onClose, onCreate, runningAgentSessions = [] }: {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
  runningAgentSessions?: readonly string[];
}) {
  return <nav className="terminal-sessions" aria-label="Terminal sessions">
    {sessions.map(session => <div className="terminal-session" key={session.id}>
      <button type="button" aria-label={`Open session ${session.title}${runningAgentSessions.includes(session.id) ? ", agent running" : ""}`} aria-current={session.id === activeId ? "page" : undefined} onClick={() => onSelect(session.id)}>{session.title}{runningAgentSessions.includes(session.id) && <span aria-label="Agent running" title="Agent running"> ●</span>}</button>
      <button type="button" className="terminal-session-close" aria-label={`Close session ${session.title}`} title="Close tab; keep history" onClick={() => onClose(session.id)}><X size={13}/></button>
    </div>)}
    <button type="button" className="terminal-session-add" aria-label="New session" onClick={onCreate}><Plus size={15}/></button>
  </nav>;
}
