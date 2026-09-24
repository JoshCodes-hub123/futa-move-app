import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "@/features/auth-pages";
export const Route = createFileRoute("/reset-password")({ head: () => ({ meta: [{ title: "Reset password — FUTAMOVE" }, { name: "description", content: "Choose a new FUTAMOVE password." }, { property: "og:title", content: "Reset password — FUTAMOVE" }, { property: "og:description", content: "Choose a new FUTAMOVE password." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: ResetPasswordPage });
