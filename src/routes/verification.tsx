import { createFileRoute } from "@tanstack/react-router";
import { VerificationPage } from "@/features/public-pages";
export const Route = createFileRoute("/verification")({ head: () => ({ meta: [{ title: "Student verification — FUTAMOVE" }, { name: "description", content: "Verify your FUTA student identity." }, { property: "og:title", content: "Student verification — FUTAMOVE" }, { property: "og:description", content: "Verify your FUTA student identity." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: VerificationPage });
