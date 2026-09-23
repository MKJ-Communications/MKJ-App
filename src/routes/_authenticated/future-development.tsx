import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { QrCode, Mail, Image, History, BellRing } from "lucide-react";

export const Route = createFileRoute("/_authenticated/future-development")({
  head: () => ({ meta: [{ title: "Future Development — MKJ Ops" }] }),
  component: FutureDevelopment,
});

type FutureFeature = {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const FEATURES: FutureFeature[] = [
  {
    title: "Inventory QR Management",
    description: "Quickly identify and manage inventory using QR codes.",
    icon: QrCode,
  },
  {
    title: "Email Alerts & Reminders",
    description: "Automated notifications and reminders for important activities and deadlines.",
    icon: Mail,
  },
  {
    title: "Inventory Images",
    description: "Add and view images associated with inventory items.",
    icon: Image,
  },
  {
    title: "Audit Trail & Activity History",
    description: "Track important changes, actions, and activity throughout the application.",
    icon: History,
  },
  {
    title: "Advanced Inventory Alerts",
    description: "Receive alerts when inventory requires attention, such as low-stock conditions.",
    icon: BellRing,
  },
];

function FutureDevelopment() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Future Development"
        description="Visual roadmap of features that could be developed in a future phase after the current MVP is reviewed and approved."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <Card
              key={feature.title}
              className="transition-shadow hover:shadow-md"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    Future Phase
                  </Badge>
                </div>
                <CardTitle className="mt-3 text-base">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
