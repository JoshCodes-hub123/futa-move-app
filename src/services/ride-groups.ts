import { supabase } from "@/integrations/supabase/client";

export const GROUP_MIN_SIZE = 3;
export const GROUP_MAX_SIZE = 5;

export interface MatchResult {
  group_id: string | null;
  compatible_count: number | null;
}

export interface RideGroupMember {
  first_name: string;
  is_me: boolean;
  is_organizer: boolean;
  meeting_point_agreed: boolean;
  joined_at: string;
}

export interface RideGroup {
  id: string;
  destination_text: string;
  departure_time: string;
  meeting_point_text: string;
  status: "forming" | "ready";
  max_size: number;
  members: RideGroupMember[];
}

export class RideGroupError extends Error {}

/** Runs matching for the signed-in student's request. Forms a group once 3 compatible students exist. */
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

export async function agreeMeetingPoint(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("agree_meeting_point", { p_group_id: groupId });
  if (error) throw new RideGroupError(error.message);
}
