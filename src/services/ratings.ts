import { supabase } from "@/integrations/supabase/client";
import { TripError, friendlyTripError } from "./trips";

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new TripError(friendlyTripError(error.message));
}

export const POSITIVE_TAGS = ["Friendly", "On time", "Safe driving", "Good communication", "Clean keke"];
export const IMPROVE_TAGS = ["Late arrival", "Communication issue", "Driving concern", "Vehicle issue", "Other"];

export interface TripRiderProfile {
  first_name: string; avatar_path: string | null; vehicle: string | null; plate: string | null;
  completed_rides: number; rating_avg: number | null; rating_count: number; distance_km: number | null;
  my_rating: number | null; confirmations: { role: "rider" | "passenger"; is_me: boolean; at: string }[];
}

export async function getTripRiderProfile(tripId: string): Promise<TripRiderProfile | null> {
  const { data, error } = await supabase.rpc("trip_rider_profile", { p_trip_id: tripId });
  fail(error);
  const p = data as unknown as TripRiderProfile | null;
  if (p?.avatar_path) {
    const { data: s } = await supabase.storage.from("rider-documents").createSignedUrl(p.avatar_path, 300);
    p.avatar_path = s?.signedUrl ?? null;
  }
  return p;
}
export async function confirmPickup(tripId: string) {
  const { data, error } = await supabase.rpc("passenger_confirm_pickup", { p_trip_id: tripId });
  fail(error);
  return data as unknown as { started: boolean };
}
export async function rateRider(tripId: string, stars: number, tags: string[]) {
  const { error } = await supabase.rpc("rate_rider", { p_trip_id: tripId, p_stars: stars, p_tags: tags });
  fail(error);
}
export async function riderConfirmedStart(tripId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("trip_confirmations").select("id").eq("trip_id", tripId).eq("user_id", auth.user?.id ?? "").maybeSingle();
  fail(error);
  return !!data;
}
export function ratingText(p: Pick<TripRiderProfile, "rating_avg" | "completed_rides">) {
  return p.rating_avg == null ? `New Rider · ${p.completed_rides} rides` : `★ ${Number(p.rating_avg).toFixed(1)} · ${p.completed_rides} rides`;
}
