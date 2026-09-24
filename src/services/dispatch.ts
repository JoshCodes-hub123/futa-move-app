import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { TripError, friendlyTripError } from "./trips";

/** Smart Dispatch: every decision is made by database rules; the browser only asks and displays. */
export type Availability = "online" | "offline" | "busy";
export type DispatchState = "searching" | "offer_pending" | "escalated" | "assigned" | "closed";
export type DispatchSettings = Tables<"dispatch_settings">;

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new TripError(friendlyTripError(error.message));
}

/* ---------- riders ---------- */
export async function getMyAvailability(): Promise<Availability> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return "offline";
  const { data, error } = await supabase.from("rider_availability").select("status").eq("rider_id", auth.user.id).maybeSingle();
  fail(error);
  return (data?.status as Availability | undefined) ?? "offline";
}
export async function setMyAvailability(status: Availability) {
  const { error } = await supabase.rpc("set_my_availability", { p_status: status });
  fail(error);
}
/** Shares the rider's real device position (only while online) so dispatch can prefer closer riders. */
export async function shareMyLocation(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  const pos = await new Promise<GeolocationPosition | null>((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }),
  );
  if (!pos) return;
  await supabase.rpc("set_my_location", { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy: pos.coords.accuracy });
}
export interface RideOffer {
  offer_id: string; trip_id: string; meeting_point_text: string; meeting_point_note: string | null; destination_text: string;
  departure_time: string; passenger_count: number; member_count: number; offered_at: string; expires_at: string;
}
export async function listMyOffers(): Promise<RideOffer[]> {
  const { data, error } = await supabase.rpc("rider_my_offers");
  fail(error);
  return (data ?? []) as RideOffer[];
}
export async function respondOffer(offerId: string, accept: boolean, reason?: string): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc("rider_respond_offer", { p_offer_id: offerId, p_accept: accept, p_reason: reason ?? "" });
  fail(error);
  return data as unknown as { ok: boolean; reason?: string };
}

/* ---------- students ---------- */
/** Lets the database move dispatch along while a student is waiting. */
export async function pingDispatch(groupId: string) {
  await supabase.rpc("student_dispatch_ping", { p_group_id: groupId });
}

/* ---------- admins ---------- */
export interface DispatchOverviewRow {
  trip_id: string; dispatch_state: DispatchState; waiting_seconds: number; offers_total: number; offers_declined: number;
  offers_timed_out: number; offers_cancelled: number; pending_rider_id: string | null; pending_expires_at: string | null; candidate_count: number | null;
}
export async function adminDispatchOverview(): Promise<Record<string, DispatchOverviewRow>> {
  const { data, error } = await supabase.rpc("admin_dispatch_overview");
  fail(error);
  return Object.fromEntries(((data ?? []) as DispatchOverviewRow[]).map((r) => [r.trip_id, r]));
}
export interface FairnessBreakdown {
  score: number; completed_today: number; completed_window: number; offers_today: number; declines_window: number; timeouts_window: number;
  withdrawals_window: number; no_shows_window: number; hours_since_last_completed: number; hours_since_last_offer: number; window_days: number;
  proximity?: string; eligibility?: string[]; suitability?: string[];
}
export interface TripDispatchDetail {
  offers: { id: string; rider_id: string; rider_name: string | null; offered_at: string; expires_at: string; responded_at: string | null; response: string; response_reason: string | null; score: number | null; reason: FairnessBreakdown | null }[];
  events: { id: string; event_type: string; rider_name: string | null; score: number | null; reason: Json; from_state: string | null; to_state: string | null; actor_role: string; created_at: string }[];
  candidates: { rider_id: string; rider_name: string | null; score: number; breakdown: FairnessBreakdown }[];
}
export async function adminTripDispatch(tripId: string): Promise<TripDispatchDetail> {
  const { data, error } = await supabase.rpc("admin_trip_dispatch", { p_trip_id: tripId });
  fail(error);
  return data as unknown as TripDispatchDetail;
}
export async function adminRedispatch(tripId: string) {
  const { error } = await supabase.rpc("admin_redispatch", { p_trip_id: tripId });
  fail(error);
}
export async function adminMarkRiderNoShow(tripId: string, reason: string) {
  const { error } = await supabase.rpc("admin_mark_rider_no_show", { p_trip_id: tripId, p_reason: reason });
  fail(error);
}
export async function getDispatchSettings(): Promise<DispatchSettings | null> {
  const { data, error } = await supabase.from("dispatch_settings").select("*").maybeSingle();
  fail(error);
  return data;
}
export async function updateDispatchSettings(s: { offer_timeout_seconds: number; max_offers: number; fairness_window_days: number; escalate_after_seconds: number; weights: Record<string, number> }) {
  const { error } = await supabase.rpc("admin_update_dispatch_settings", {
    p_offer_timeout_seconds: s.offer_timeout_seconds, p_max_offers: s.max_offers, p_fairness_window_days: s.fairness_window_days,
    p_escalate_after_seconds: s.escalate_after_seconds, p_weights: s.weights,
  });
  fail(error);
}

export const DISPATCH_STATE_LABEL: Record<DispatchState, string> = {
  searching: "Waiting for rider", offer_pending: "Offer pending", escalated: "Needs admin attention", assigned: "Rider assigned", closed: "Closed",
};
export const EVENT_LABEL: Record<string, string> = {
  CANDIDATE_SELECTED: "Candidate selected", OFFER_CREATED: "Offer sent", OFFER_ACCEPTED: "Offer accepted", OFFER_DECLINED: "Offer declined",
  OFFER_TIMED_OUT: "Offer timed out", OFFER_CANCELLED: "Offer cancelled", RIDER_ASSIGNED: "Rider assigned", RIDER_REASSIGNED: "Rider reassigned",
  RIDER_SELF_ACCEPTED: "Rider accepted from waiting list", RIDER_WITHDREW: "Rider withdrew", RIDER_NO_SHOW: "Rider no-show",
  ASSIGNMENT_ACCEPTED: "Assignment accepted", ASSIGNMENT_DECLINED: "Assignment declined", DISPATCH_ESCALATED: "Escalated to admin", DISPATCH_RESTARTED: "Dispatch restarted",
};
export function fmtWait(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`;
}
