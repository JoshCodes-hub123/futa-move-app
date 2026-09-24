import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type RideRequest = Tables<"ride_requests">;
export type RideRequestStatus = RideRequest["status"];

export interface RideRequestDraft {
  originText: string;
  originLatitude?: number | null;
  originLongitude?: number | null;
  destinationText: string;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  meetingPointText: string;
  /** ISO timestamp */
  departureTime: string;
}

export class RideRequestError extends Error {}

/** Creates a ride request for the signed-in student and puts it in the searching state. */
export async function createRideRequest(draft: RideRequestDraft): Promise<RideRequest> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    throw new RideRequestError("You need to be signed in to request a ride.");
  }

  const { data, error } = await supabase
    .from("ride_requests")
    .insert({
      student_id: auth.user.id,
      origin_text: draft.originText.trim(),
      origin_latitude: draft.originLatitude ?? null,
      origin_longitude: draft.originLongitude ?? null,
      destination_text: draft.destinationText.trim(),
      destination_latitude: draft.destinationLatitude ?? null,
      destination_longitude: draft.destinationLongitude ?? null,
      departure_time: draft.departureTime,
      meeting_point_text: draft.meetingPointText.trim(),
      status: "searching",
    })
    .select()
    .single();

  if (error || !data) {
    throw new RideRequestError(
      error?.message ? `We couldn't create your ride request. ${error.message}` : "We couldn't create your ride request.",
    );
  }
  return data;
}

export async function listRideRequests(): Promise<RideRequest[]> {
  const { data, error } = await supabase
    .from("ride_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new RideRequestError(error.message);
  return data ?? [];
}

export async function getRideRequest(id: string): Promise<RideRequest | null> {
  const { data, error } = await supabase.from("ride_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new RideRequestError(error.message);
  return data;
}

export async function cancelRideRequest(id: string): Promise<RideRequest> {
  const { data, error } = await supabase
    .from("ride_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select()
    .single();
  if (error || !data) throw new RideRequestError(error?.message ?? "We couldn't cancel this request.");
  return data;
}

/* ---------- formatting helpers ---------- */

export function formatDepartureTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (sameDay(date, today)) return `Today · ${time}`;
  if (sameDay(date, tomorrow)) return `Tomorrow · ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}

export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function roundedSuggestions(from = new Date()): { label: string; iso: string }[] {
  return [15, 30, 60].map((minutes) => {
    const date = new Date(from.getTime() + minutes * 60_000);
    date.setSeconds(0, 0);
    return {
      label: `In ${minutes < 60 ? `${minutes} min` : "1 hour"}`,
      iso: date.toISOString(),
    };
  });
}
