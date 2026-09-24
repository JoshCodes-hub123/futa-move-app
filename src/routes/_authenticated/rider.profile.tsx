import { createFileRoute } from "@tanstack/react-router";
import { RiderProfilePage } from "@/features/app-pages";
export const Route = createFileRoute("/_authenticated/rider/profile")({ head: () => ({ meta: [{ title: "Rider profile — FUTAMOVE" }, { name: "description", content: "Manage your FUTAMOVE rider profile." }, { property: "og:title", content: "Rider profile — FUTAMOVE" }, { property: "og:description", content: "Manage your FUTAMOVE rider profile." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: RiderProfilePage });
