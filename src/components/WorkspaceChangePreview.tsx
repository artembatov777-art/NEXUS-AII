import { useEffect, useMemo, useRef, useState } from "react";
import { ToolGateway, type ToolAuditEvent } from "../core/tools";
import { err } from "../core/result";
import { MAX_EDIT_BYTES, parseReplacements, prepareChanges, type DraftFile, type ReplacementSpan, type WorkspaceSnapshot } from "../core/workspaceChangePreview";
import { NativeToolAuditSink } from "../lib/nativeEventRepositories";
import { registerWorkspaceSnapshotTool } from "../lib/workspaceTools";

interface Plan {
  id: string;
  files: readonly DraftFile[];
  spans: readonly ReplacementSpan[];
}

function workspacePath(root: string, relative: string) {
  if (/[:\u0000-\u001f\u007f]/u.test(relative)) return null;
  const parts = relative.split(/[\\/]/);
  if (parts.some(part => !part || part === "." || part === "..")) return null;
  const separator = root.includes("\\") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + separator + parts.join(separator);
}

export function WorkspaceChangePreview({ root }: { root: string }) {
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [states, setStates] = useState<string[]>([]);
  const [events, setEvents] = useState<ToolAuditEvent[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);

  const { gateway, audit } = useMemo(() => {
    const audit = new NativeToolAuditSink();
    const gateway = new ToolGateway({
      authorize: async request => request.scope === "filesystem:read:selected" &&
        window.confirm(`Read this file for the workspace plan?\n\n${request.resource}`) ? "allow" : "deny"
    }, audit, { now: Date.now });
    const registration = registerWorkspaceSnapshotTool(gateway);
    if (!registration.ok) throw new Error(registration.error.message);
    return { gateway, audit };
  }, []);

  async function inspect(check: Plan | null) {
    if (active.current) return;
    setMessage("");
    setStates([]);
    let changes;
    if (!check) {
      setPlan(null);
      setEvents([]);
      if (new TextEncoder().encode(input).byteLength > MAX_EDIT_BYTES) {
        setMessage("Preview input exceeds 48 KB.");
        return;
      }
      try { changes = parseReplacements(JSON.parse(input)); }
      catch { setMessage("Enter a valid JSON array of replacements."); return; }
      if (!changes.ok) { setMessage(changes.error.message); return; }
      if (changes.value.some(change => !workspacePath(root, change.path))) {
        setMessage("Use file paths relative to the selected folder.");
        return;
      }
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const id = check?.id ?? crypto.randomUUID();
    const read = (relative: string) => {
      const path = workspacePath(root, relative);
      if (!path) return Promise.resolve(err("validation", "Invalid relative workspace path."));
      return gateway.execute<WorkspaceSnapshot>("workspace.snapshot", { path }, {
        runId: id, traceId: crypto.randomUUID(), signal: controller.signal
      }, "desktop-owner");
    };
    try {
      if (check) {
        const observations: string[] = [];
        for (const file of check.files) {
          if (controller.signal.aborted) break;
          const latest = await read(file.path);
          if (!latest.ok) observations.push(`${file.path} — ${latest.error.message}`);
          else if (latest.value.content !== file.before || latest.value.revision !== file.revision) {
            observations.push(`${file.path} — changed since the plan`);
          } else {
            observations.push(`${file.path} — ${file.revision ? "revision matches" : "content matches; revision unavailable"}`);
          }
        }
        if (!controller.signal.aborted) setStates(observations);
      } else if (changes?.ok) {
        const result = await prepareChanges(changes.value, read, controller.signal);
        if (!controller.signal.aborted) {
          if (result.ok) setPlan({ id, ...result.value });
          else setMessage(result.error.message);
        }
      }
    } finally {
      const history = await audit.list({ runId: id, limit: 40 });
      if (!controller.signal.aborted) {
        if (history.ok) setEvents(Array.isArray(history.value) ? history.value : []);
        else setMessage(history.error.message);
      }
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return <details className="file-access-grant file-plan-preview">
    <summary>Multi-file change preview</summary>
    <p>Project folder: {root}</p>
    <p>Preview and revision checks are available. Applying or rolling back multi-file changes from Desktop is unavailable.</p>
    <label>Replacement plan (JSON)
      <textarea aria-label="Replacement plan (JSON)" value={input} onChange={event => {
        setInput(event.target.value);
        setPlan(null);
        setStates([]);
        setEvents([]);
        setMessage("");
      }} disabled={busy} placeholder={'[{"path":"notes.txt","from":"old text","to":"new text"}]'} />
    </label>
    <button className="secondary-btn" type="button" onClick={() => void inspect(null)} disabled={busy || !input.trim()}>Preview plan</button>
    {busy && <button className="secondary-btn" type="button" onClick={() => {
      active.current?.abort();
      setMessage("Preview cancelled.");
    }}>Cancel preview</button>}
    {message && <p role="status">{message}</p>}
    {plan && <div>
      <p>Plan ID: <code>{plan.id}</code></p>
      {plan.spans.map((span, index) => <section key={span.path} aria-label={`Changes for ${span.path}`}>
        <strong>{span.path} · offset {span.offset}</strong>
        {plan.files[index].revision && <p>Revision: <code>{plan.files[index].revision}</code></p>}
        <div className="file-edit-diff">
          <div><strong>Before</strong><pre><del>{span.from.replace(/\r/g, "␍")}</del></pre></div>
          <div><strong>After</strong><pre><ins>{span.to.replace(/\r/g, "␍")}</ins></pre></div>
        </div>
      </section>)}
      <button className="secondary-btn" type="button" onClick={() => void inspect(plan)} disabled={busy}>Check current revisions</button>
      {states.length > 0 && <ul aria-label="Revision check">{states.map(state => <li key={state}>{state}</li>)}</ul>}
    </div>}
    {events.length > 0 && <details>
      <summary>Tool Gateway audit</summary>
      <ul aria-label="Tool Gateway audit">{events.map(event =>
        <li key={event.traceId + ":" + event.status}>{event.toolId} · {event.status}</li>)}</ul>
    </details>}
    <p>For CLI operation recovery, use <code>/recover &lt;operation ID&gt;</code> in the terminal.</p>
  </details>;
}
