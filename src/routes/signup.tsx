import { createFileRoute } from "@tanstack/react-router";
import { SignupPage } from "@/features/public-pages";
export const Route = createFileRoute("/signup")({ head: () => ({ meta: [{ title: "Create account — FUTAMOVE" }, { name: "description", content: "Create your FUTAMOVE student account." }, { property: "og:title", content: "Create account — FUTAMOVE" }, { property: "og:description", content: "Create your FUTAMOVE student account." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: SignupPage });
