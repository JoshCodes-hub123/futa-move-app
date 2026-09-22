import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/features/public-pages";
export const Route = createFileRoute("/login")({ head: () => ({ meta: [{ title: "Sign in — FUTAMOVE" }, { name: "description", content: "Sign in to your FUTAMOVE account." }, { property: "og:title", content: "Sign in — FUTAMOVE" }, { property: "og:description", content: "Sign in to your FUTAMOVE account." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: LoginPage });
