import { supabase } from "@/integrations/supabase/client";

/**
 * Role is decided by the database (user_roles). The browser only reads it to pick a dashboard.
 * "applicant" = has a rider application but no active role (pending, rejected or suspended).
 */
export type AppRole = "student" | "lecturer" | "rider" | "admin" | "applicant";

function parse(data: unknown): AppRole | null {
  return data === "student" || data === "lecturer" || data === "rider" || data === "admin" || data === "applicant" ? data : null;
}

export async function getMyRole(): Promise<AppRole | null> {
  const { data, error } = await supabase.rpc("get_my_role");
  if (error) throw new Error(error.message);
  return parse(data);
}

/** Only succeeds in granting 'student' when the account has no role at all. */
export async function claimStudentRole(): Promise<AppRole | null> {
  const { data, error } = await supabase.rpc("claim_student_role");
  if (error) throw new Error(error.message);
  return parse(data);
}

export function homeForRole(role: AppRole | null): "/student/home" | "/rider/home" | "/admin/verification" | "/rider-application" | "/account-setup" {
  if (role === "admin") return "/admin/verification";
  if (role === "rider") return "/rider/home";
  if (role === "student" || role === "lecturer") return "/student/home";
  if (role === "applicant") return "/rider-application";
  return "/account-setup";
}

/** Converts a brand-new account into a lecturer account (server-checked). */
export async function claimLecturerRole(): Promise<AppRole | null> {
  const { data, error } = await supabase.rpc("claim_lecturer_role");
  if (error) throw new Error(error.message);
  return parse(data);
}
