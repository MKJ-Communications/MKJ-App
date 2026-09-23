import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { BuildRequestForm } from "@/components/build-request-form";

export const Route = createFileRoute("/_authenticated/manufacturing/new")({
  head: () => ({ meta: [{ title: "New build request — MKJ Ops" }] }),
  component: NewBuildRequestPage,
});

function NewBuildRequestPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="New build request"
        description="Ask the shop to build standard systems from this project's stock. At least 80% of the parts, and every key part, must be in stock to submit."
        backTo="/manufacturing"
      />
      <BuildRequestForm />
    </div>
  );
}
