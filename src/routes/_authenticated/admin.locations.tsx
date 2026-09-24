import { createFileRoute } from "@tanstack/react-router";
import { AdminLocationsPage } from "@/features/admin-console";

export const Route = createFileRoute("/_authenticated/admin/locations")({
  head: () => ({ meta: [{ title: "Location management — FUTAMOVE Admin" }, { name: "description", content: "Manage approved FUTAMOVE campus locations." }, { property: "og:title", content: "Location management — FUTAMOVE Admin" }, { property: "og:description", content: "Manage approved FUTAMOVE campus locations." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: AdminLocationsPage,
});
