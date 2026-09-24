import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/role-gate";

export const Route = createFileRoute("/_authenticated/rider")({
  beforeLoad: () => requireRole("rider"),
  component: () => <Outlet />,
});
