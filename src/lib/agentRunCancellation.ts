export function throwIfAgentCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Agent task cancelled.");
}
export async function raceAgentCancellation<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAgentCancelled(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new Error("Agent task cancelled.")); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) onAbort();
  });
}
