import { supabase } from "@/integrations/supabase/client";

/** Mirrors public.ride_capacity() — the database is the authority. */
export const KEKE_CAPACITY = 4;

export interface MatchResult {
  group_id: string | null;
  compatible_count: number | null;
  /** false when the student is not a verified FUTA student yet */
  eligible: boolean;
}

export interface RideGroupMember {
  first_name: string;
  is_me: boolean;
  is_organizer: boolean;
  party_size: number;
  meeting_point_agreed: boolean;
  joined_at: string;
}

export interface RideGroup {
  id: string;
  destination_text: string;
  departure_time: string;
  meeting_point_text: string;
  /** Authoritative meeting point (approved location); text is the display snapshot. */
  meeting_point_location_id: string | null;
  meeting_point_active: boolean;
  meeting_point_note: string | null;
  meeting_point_version: number;
  my_origin_text: string | null;
  can_manage_meeting_point: boolean;
  status: "forming" | "ready" | "cancelled" | "completed";
  capacity: number;
  passenger_count: number;
  members: RideGroupMember[];
}

export class RideGroupError extends Error {}

/** Runs matching for the signed-in student's request (joins or forms a compatible group). */
export async function matchRideRequest(requestId: string): Promise<MatchResult> {
  const { data, error } = await supabase.rpc("match_ride_request", { p_request_id: requestId });
  if (error) throw new RideGroupError(error.message);
  return data as unknown as MatchResult;
}

export async function getRideGroup(groupId: string): Promise<RideGroup> {
  const { data, error } = await supabase.rpc("get_ride_group", { p_group_id: groupId });
  if (error || !data) throw new RideGroupError(error?.message ?? "We couldn't load your group.");
  return data as unknown as RideGroup;
}

export async function addGroupMember(groupId: string): Promise<{ added: boolean; reason?: "full" | "none_available" }> {
  const { data, error } = await supabase.rpc("add_group_member", { p_group_id: groupId });
  if (error) throw new RideGroupError(error.message);
  return data as unknown as { added: boolean; reason?: "full" | "none_available" };
}

/** Confirms the specific proposal the student saw; fails if it changed meanwhile. */
export async function confirmMeetingPoint(groupId: string, version: number): Promise<void> {
  const { error } = await supabase.rpc("confirm_meeting_point", { p_group_id: groupId, p_version: version });
  if (error) throw new RideGroupError(error.message);
}

export async function leaveRideGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_ride_group", { p_group_id: groupId });
  if (error) throw new RideGroupError(error.message);
}

export async function setMeetingPoint(groupId: string, locationId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("set_meeting_point", { p_group_id: groupId, p_location_id: locationId, p_note: note.trim() || undefined });
  if (error) throw new RideGroupError(error.message);
}
