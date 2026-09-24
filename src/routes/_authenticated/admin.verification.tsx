import { createFileRoute } from "@tanstack/react-router";
import { AdminVerificationPage } from "@/features/admin-verification";

export const Route = createFileRoute("/_authenticated/admin/verification")({
  head: () => ({ meta: [{ title: "Verification review — FUTAMOVE Admin" }, { name: "description", content: "Review FUTA student verification submissions." }, { property: "og:title", content: "Verification review — FUTAMOVE Admin" }, { property: "og:description", content: "Review FUTA student verification submissions." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: AdminVerificationPage,
});
