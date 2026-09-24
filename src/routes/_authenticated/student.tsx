import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/role-gate";

export const Route = createFileRoute("/_authenticated/student")({
  beforeLoad: () => requireRole("student"),
  component: () => <Outlet />,
});
