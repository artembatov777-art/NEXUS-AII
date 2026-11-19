import type { ReactNode } from "react";

/** Keep stateful subsystems mounted when their window is hidden. */
export function KeepAlivePanel({ open, children }: { open: boolean; children: ReactNode }) {
  return <div hidden={!open} aria-hidden={!open}>{children}</div>;
}
