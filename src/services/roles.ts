import { supabase } from "@/integrations/supabase/client";

/** Role is decided by the database (user_roles). The browser only reads it to pick a dashboard. */
export type AppRole = "student" | "rider" | "admin";

export async function getMyRole(): Promise<AppRole | null> {
  const { data, error } = await supabase.rpc("get_my_role");
  if (error) throw new Error(error.message);
  return data === "student" || data === "rider" || data === "admin" ? data : null;
}

/** Only succeeds in granting 'student' when the account has no role at all. */
export async function claimStudentRole(): Promise<AppRole | null> {
  const { data, error } = await supabase.rpc("claim_student_role");
  if (error) throw new Error(error.message);
  return data === "student" || data === "rider" || data === "admin" ? data : null;
}

export function homeForRole(role: AppRole | null): "/student/home" | "/rider/home" | "/admin/verification" | "/account-setup" {
  if (role === "admin") return "/admin/verification";
  if (role === "rider") return "/rider/home";
  if (role === "student") return "/student/home";
  return "/account-setup";
}
