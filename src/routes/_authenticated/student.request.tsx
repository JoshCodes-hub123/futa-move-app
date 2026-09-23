import { createFileRoute } from "@tanstack/react-router";
import { RideRequestPage } from "@/features/ride-request";

export const Route = createFileRoute("/_authenticated/student/request")({
  head: () => ({ meta: [{ title: "Request a ride — FUTAMOVE" }, { name: "description", content: "Create a FUTAMOVE student ride request." }] }),
  component: RideRequestPage,
});
