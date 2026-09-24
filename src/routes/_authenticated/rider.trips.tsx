import { createFileRoute } from "@tanstack/react-router";
import { RiderTripsPage } from "@/features/rider-trips";
export const Route = createFileRoute("/_authenticated/rider/trips")({ head: () => ({ meta: [{ title: "Rider trips — FUTAMOVE" }, { name: "description", content: "View your FUTAMOVE rider trips." }, { property: "og:title", content: "Rider trips — FUTAMOVE" }, { property: "og:description", content: "View your FUTAMOVE rider trips." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: RiderTripsPage });
