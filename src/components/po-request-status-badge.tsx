import { cn } from "@/lib/utils";
import type { PoRequestStatus } from "@/lib/po-requests";

const CONFIG: Record<PoRequestStatus, { label: string; badge: string; dot: string }> = {
  pending: {
    label: "Pending",
    badge: "bg-status-partial text-status-partial-foreground",
    dot: "bg-status-partial-foreground",
  },
  completed: {
    label: "Completed",
    badge: "bg-status-received text-status-received-foreground",
    dot: "bg-status-received-foreground",
  },
  cancelled: {
    label: "Cancelled",
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

export function PORequestStatusBadge({
  status,
  poReference,
  className,
}: {
  status: PoRequestStatus;
  poReference?: string | null;
  className?: string;
}) {
  const c = CONFIG[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", c.badge, className)}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", c.dot)} aria-hidden />
      {c.label}
      {status === "completed" && poReference ? <span className="font-mono">· {poReference}</span> : null}
    </span>
  );
}

/** Marks the row type in the shared Purchase Orders list, so a request is never mistaken for a PO. */
export function RowTypeChip({ kind }: { kind: "po" | "request" }) {
  return kind === "request" ? (
    <span className="inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
      Request
    </span>
  ) : (
    <span className="inline-flex items-center rounded border bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      PO
    </span>
  );
}

/** Flags a request line that was typed in rather than picked from the products list. */
export function TypedItemBadge() {
  return (
    <span className="shrink-0 rounded bg-status-partial px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-partial-foreground">
      Typed
    </span>
  );
}
