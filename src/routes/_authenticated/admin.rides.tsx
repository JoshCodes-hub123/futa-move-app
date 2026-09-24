import { createFileRoute } from "@tanstack/react-router";
import { AdminRidesPage } from "@/features/admin-rides";
export const Route = createFileRoute("/_authenticated/admin/rides")({ head: () => ({ meta: [{ title: "Rides — Admin — FUTAMOVE" }, { name: "description", content: "Assign riders and manage FUTAMOVE trips." }, { property: "og:title", content: "Rides — Admin — FUTAMOVE" }, { property: "og:description", content: "Assign riders and manage FUTAMOVE trips." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: AdminRidesPage });
