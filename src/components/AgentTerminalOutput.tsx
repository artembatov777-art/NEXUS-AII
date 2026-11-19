import { useEffect, useState } from "react";
import { AgentRunManager, type ManagedRun, type ManagedRunEvent } from "../lib/agentRunManager";
import { latestAgentRun } from "../lib/agentRunSelection";
import { agentRunEventPreview } from "../lib/agentRunEventPreview";
import { agentRunStatusLabel } from "../lib/agentRunPresentation";

interface AgentTerminalSnapshot { run: ManagedRun | null; events: ManagedRunEvent[] }

/** Conversation-scoped, live view of the same executions supervised by Agent Center. */
export function AgentTerminalOutput({ agentRuns, conversationId, onOpen }: {
  agentRuns: AgentRunManager;
  conversationId: string;
  onOpen: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AgentTerminalSnapshot>({ run: null, events: [] });
  useEffect(() => {
    const refresh = () => {
      const run = latestAgentRun(agentRuns.list(conversationId), conversationId);
      setSnapshot({ run, events: run ? agentRuns.history(run.id).slice(-8) : [] });
    };
    const unsubscribeRuns = agentRuns.subscribe(refresh);
    const unsubscribeEvents = agentRuns.subscribeEvents(event => {
      if (event.conversationId === conversationId) refresh();
    });
    return () => { unsubscribeRuns(); unsubscribeEvents(); };
  }, [agentRuns, conversationId]);

  const { run, events } = snapshot;
  if (!run || run.conversationId !== conversationId) return null;
  return <section className="agent-terminal-output" aria-label="Agent terminal activity" aria-live="polite">
    <div className="agent-terminal-heading">
      <strong>AGENT / {agentRunStatusLabel(run.status)}</strong>
      <div className="agent-terminal-controls">
        {run.status === "running" && <button type="button" onClick={() => agentRuns.cancel(run.id)} aria-label="Cancel this agent run">Cancel</button>}
        <button type="button" onClick={onOpen}>Open Agent Center</button>
      </div>
    </div>
    {events.length > 0 && <ol className="agent-terminal-events">
      {events.map((event, index) => <li key={run.id + ":" + index} data-kind={event.kind}>
        <span>{event.kind.toUpperCase()}</span><pre>{agentRunEventPreview(event.message, 360)}</pre>
      </li>)}
    </ol>}
  </section>;
}
