import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { BuildRequestForm } from "@/components/build-request-form";
import { Button } from "@/components/ui/button";
import { useRoles } from "@/hooks/use-session";
import { useMyManagedProjectIds } from "@/lib/po-requests";
import { buildPermissions, useBuildRequest } from "@/lib/build-requests";

// Kept off /manufacturing/$id/... so it doesn't nest under the detail page.
export const Route = createFileRoute("/_authenticated/manufacturing/edit/$id")({
  head: () => ({ meta: [{ title: "Edit build request — MKJ Ops" }] }),
  component: EditBuildRequestPage,
});

function EditBuildRequestPage() {
  const { id } = Route.useParams();
  const query = useBuildRequest(id);
  const roles = useRoles();
  const managed = useMyManagedProjectIds();

  if (query.isLoading || roles.isLoading || managed.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const request = query.data?.request;
  if (!request) return <p className="text-sm text-muted-foreground">Build request not found.</p>;

  if (!buildPermissions(request, roles.data ?? [], managed.data ?? []).canEdit) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <PageHeader title={`Edit ${request.request_number}`} backTo={`/manufacturing/${id}`} />
        <p className="text-sm text-muted-foreground">
          {request.status === "submitted"
            ? "This request is submitted. Pull it back to draft to edit it, or ask the warehouse to change its parts list."
            : "Only drafts and rejected requests can be edited (and submitted ones, by the warehouse)."}
        </p>
        <Button variant="outline" asChild>
          <Link to="/manufacturing/$id" params={{ id }}>Back to {request.request_number}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={request.status === "submitted" ? `Change parts for ${request.request_number}` : `Edit ${request.request_number}`}
        description={
          request.status === "submitted"
            ? "Saving recalculates what's held (the 80% rule still applies) and tells the requester."
            : request.status === "rejected"
              ? "Saving turns it back into a draft. Submit it again when it's ready."
              : undefined
        }
        backTo={`/manufacturing/${id}`}
      />
      <BuildRequestForm key={request.id} request={request} />
    </div>
  );
}
