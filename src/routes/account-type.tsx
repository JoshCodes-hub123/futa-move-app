import { createFileRoute } from "@tanstack/react-router";
import { AccountTypePage } from "@/features/public-pages";
export const Route = createFileRoute("/account-type")({ head: () => ({ meta: [{ title: "Choose account type — FUTAMOVE" }, { name: "description", content: "Choose how you will use FUTAMOVE." }, { property: "og:title", content: "Choose account type — FUTAMOVE" }, { property: "og:description", content: "Choose how you will use FUTAMOVE." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: AccountTypePage });
