import { redirect } from "@tanstack/react-router";
import { getMyRole, homeForRole, type AppRole } from "@/services/roles";

/**
 * Client-side routing convenience only. Real protection lives in the database
 * (RLS + has_role checks inside functions), so a bypassed gate reveals nothing.
 */
export async function requireRole(required: AppRole) {
  const role = await getMyRole();
  if (role !== required) throw redirect({ to: homeForRole(role) });
  return { role };
}
