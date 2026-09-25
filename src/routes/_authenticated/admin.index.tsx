import { createFileRoute } from "@tanstack/react-router";
import { AdminOverviewPage } from "@/features/admin-overview";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Overview — FUTAMOVE Admin" }, { name: "description", content: "Live operational overview of FUTAMOVE rides, queues and riders." }, { property: "og:title", content: "Overview — FUTAMOVE Admin" }, { property: "og:description", content: "Live operational overview of FUTAMOVE rides, queues and riders." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: AdminOverviewPage,
});
