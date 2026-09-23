import { createFileRoute } from "@tanstack/react-router";
import { RideRequestDetailPage } from "@/features/student-rides";

export const Route = createFileRoute("/_authenticated/student/rides/$id")({
  head: () => ({ meta: [{ title: "Ride request — FUTAMOVE" }, { name: "description", content: "View your FUTAMOVE ride request." }] }),
  component: RequestDetailRoute,
});

function RequestDetailRoute() {
  const { id } = Route.useParams();
  return <RideRequestDetailPage id={id} />;
}
