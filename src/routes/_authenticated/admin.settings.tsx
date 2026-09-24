import { createFileRoute } from "@tanstack/react-router";
import { AdminSettingsPage } from "@/features/admin-console";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Admin settings — FUTAMOVE" }, { name: "description", content: "FUTAMOVE administrator account settings." }, { property: "og:title", content: "Admin settings — FUTAMOVE" }, { property: "og:description", content: "FUTAMOVE administrator account settings." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: AdminSettingsPage,
});
