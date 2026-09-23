import { createFileRoute } from "@tanstack/react-router";
import { StudentProfilePage } from "@/features/app-pages";
export const Route = createFileRoute("/student/profile")({ head: () => ({ meta: [{ title: "Student profile — FUTAMOVE" }, { name: "description", content: "Manage your FUTAMOVE student profile." }, { property: "og:title", content: "Student profile — FUTAMOVE" }, { property: "og:description", content: "Manage your FUTAMOVE student profile." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: StudentProfilePage });
