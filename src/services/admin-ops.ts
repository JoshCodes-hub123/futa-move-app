import { supabase } from "@/integrations/supabase/client";
import { friendlyMessage } from "@/lib/friendly-error";

/** Admin-only operational reads. Every function checks the admin role on the server. */
export interface OpsOverview {
  active_rides: number; waiting_for_rider: number; in_progress: number; needs_action: number;
  pending_student_verifications: number; pending_lecturer_verifications: number; pending_rider_applications: number;
  approved_riders: number; online_riders: number; busy_riders: number; pending_location_suggestions: number;
  requests_total: number; requests_today: number; completed_total: number; completed_today: number;
  cancelled_total: number; no_show_total: number;
}
export interface RiderPoolRow {
  user_id: string; availability: "online" | "offline" | "busy"; location_updated_at: string | null;
  current_trip_id: string | null; current_trip_status: string | null; current_trip_route: string | null;
  completed_rides: number; rating_avg: number | null; rating_count: number;
}
export interface AuditRow { at: string; actor_email: string | null; action: string; target: string | null; reason: string | null; trip_id: string | null }

function fail(error: { message: string } | null) {
  if (error) throw new Error(friendlyMessage(error.message));
}

export async function adminOpsOverview(): Promise<OpsOverview> {
  const { data, error } = await supabase.rpc("admin_ops_overview");
  fail(error);
  return data as unknown as OpsOverview;
}
export async function adminRiderPool(): Promise<Record<string, RiderPoolRow>> {
  const { data, error } = await supabase.rpc("admin_rider_pool");
  fail(error);
  return Object.fromEntries(((data ?? []) as RiderPoolRow[]).map((r) => [r.user_id, r]));
}
export async function adminTripPassengers(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc("admin_trip_passengers");
  fail(error);
  return Object.fromEntries((data ?? []).map((r) => [r.trip_id, r.passenger_names ?? ""]));
}
export async function adminAuditLog(limit = 100): Promise<AuditRow[]> {
  const { data, error } = await supabase.rpc("admin_audit_log", { p_limit: limit });
  fail(error);
  return (data ?? []) as AuditRow[];
}
