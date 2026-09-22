import { createFileRoute } from "@tanstack/react-router";
import { RiderHomePage } from "@/features/app-pages";
export const Route = createFileRoute("/rider/home")({ head: () => ({ meta: [{ title: "Rider home — FUTAMOVE" }, { name: "description", content: "Manage your FUTAMOVE rider availability." }, { property: "og:title", content: "Rider home — FUTAMOVE" }, { property: "og:description", content: "Manage your FUTAMOVE rider availability." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: RiderHomePage });
