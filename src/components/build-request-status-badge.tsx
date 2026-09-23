import { cn } from "@/lib/utils";
import { BUILD_STATUS_LABELS, type BuildStatus, type LineOrigin } from "@/lib/build-requests";

const STYLE: Record<BuildStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-primary/10 text-primary",
  in_progress: "bg-status-partial text-status-partial-foreground",
  partially_built: "bg-status-partial text-status-partial-foreground",
  completed: "bg-status-received text-status-received-foreground",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function BuildStatusBadge({ status, className }: { status: BuildStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STYLE[status], className)}>
      {BUILD_STATUS_LABELS[status]}
    </span>
  );
}

/** Marks a request line that differs from the system's parts list. */
export function LineOriginBadge({ origin }: { origin: LineOrigin }) {
  if (origin === "template") return null;
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {origin === "added" ? "Added" : "Changed"}
    </span>
  );
}

/** Covered / N pending, for a line's stock state. */
export function LineStockState({ covered, pending }: { covered: boolean; pending: string }) {
  return covered ? (
    <span className="rounded bg-status-received px-1.5 py-0.5 text-xs font-medium text-status-received-foreground">Covered</span>
  ) : (
    <span className="rounded bg-status-partial px-1.5 py-0.5 text-xs font-medium text-status-partial-foreground">{pending} pending</span>
  );
}
