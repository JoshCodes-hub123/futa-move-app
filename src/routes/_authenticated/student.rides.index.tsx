import { createFileRoute } from "@tanstack/react-router";
import { StudentRidesPage } from "@/features/student-rides";

export const Route = createFileRoute("/_authenticated/student/rides/")({
  head: () => ({ meta: [{ title: "Your rides — FUTAMOVE" }, { name: "description", content: "View your FUTAMOVE ride requests." }] }),
  component: StudentRidesPage,
});
