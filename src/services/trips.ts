import { supabase } from "@/integrations/supabase/client";
import { friendlyMessage } from "@/lib/friendly-error";
import type { Tables } from "@/integrations/supabase/types";

/** Every status change happens inside database functions; the browser only asks. */
export type Trip = Tables<"trips">;
export type TripHistory = Tables<"trip_status_history">;
export type TripStatus =
  | "confirmed" | "assigned" | "accepted" | "arriving" | "picked_up" | "in_progress" | "completed"
  | "cancelled_by_student" | "cancelled_by_rider" | "cancelled_by_admin" | "expired" | "no_show";

export const ACTIVE_TRIP_STATUSES: TripStatus[] = ["assigned", "accepted", "arriving", "picked_up", "in_progress"];
export function isTerminal(s: string) {
  return ["completed", "cancelled_by_student", "cancelled_by_rider", "cancelled_by_admin", "expired", "no_show"].includes(s);
}
export function isCancelled(s: string) {
  return isTerminal(s) && s !== "completed";
}

export const STUDENT_TRIP_LABEL: Record<TripStatus, string> = {
  confirmed: "Waiting for a rider",
  assigned: "Rider assigned",
  accepted: "Rider accepted",
  arriving: "Rider is on the way",
  picked_up: "Picked up",
  in_progress: "Ride in progress",
  completed: "Ride completed",
  cancelled_by_student: "Ride cancelled",
  cancelled_by_rider: "Ride cancelled",
  cancelled_by_admin: "Cancelled by FUTAMOVE",
  expired: "Ride expired",
  no_show: "Marked as no-show",
};

/** Student-facing wording; dispatch internals stay hidden. */
export function studentTripLabel(status: TripStatus, dispatchState?: string | null, confirmedAt?: string | null) {
  if (status === "confirmed" || status === "assigned") {
    if (dispatchState === "escalated") return "FUTAMOVE support is reviewing your ride";
    if (status === "assigned") return "Rider assigned";
    const waited = confirmedAt ? (Date.now() - new Date(confirmedAt).getTime()) / 60000 : 0;
    if (dispatchState === "offer_pending" || dispatchState === "searching") return waited > 3 ? "Still finding a rider" : "Finding a rider";
    return "Waiting for a rider";
  }
  return STUDENT_TRIP_LABEL[status];
}

export const ADMIN_TRIP_LABEL: Record<TripStatus, string> = {
  confirmed: "Pending assignment",
  assigned: "Assigned",
  accepted: "Accepted",
  arriving: "Arriving",
  picked_up: "Picked up",
  in_progress: "In progress",
  completed: "Completed",
  cancelled_by_student: "Cancelled by student",
  cancelled_by_rider: "Cancelled by rider",
  cancelled_by_admin: "Cancelled by admin",
  expired: "Expired",
  no_show: "No-show",
};

export class TripError extends Error {}
/** Turns structured database refusals into user-safe wording. */
export function friendlyTripError(message: string) {
  if (message.includes("NOT_AUTHORIZED_TO_CHANGE_TRIP_STATUS") || /permission denied/i.test(message)) {
    return "You're not allowed to change this ride. Use the buttons on this screen instead.";
  }
  return friendlyMessage(message);
}
function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new TripError(friendlyTripError(error.message));
}

/* ---------- students ---------- */
export async function confirmRide(groupId: string) {
  const { error } = await supabase.rpc("confirm_ride", { p_group_id: groupId });
  fail(error);
}
/** Trips for groups the signed-in student belongs to (RLS). */
export async function listMyGroupTrips(): Promise<Pick<Trip, "group_id" | "status" | "dispatch_state">[]> {
  const { data, error } = await supabase.from("trips").select("group_id,status,dispatch_state");
  fail(error);
  return data ?? [];
}

/* ---------- riders ---------- */
export interface AvailableTrip {
  id: string; meeting_point_text: string; meeting_point_note: string | null; destination_text: string;
  departure_time: string; passenger_count: number; member_count: number; confirmed_at: string;
}
export async function listAvailableTrips(): Promise<AvailableTrip[]> {
  const { data, error } = await supabase.rpc("rider_available_trips");
  fail(error);
  return (data ?? []) as AvailableTrip[];
}
export async function listMyRiderTrips(): Promise<Trip[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase.from("trips").select("*").eq("rider_id", auth.user.id).order("departure_time", { ascending: false });
  fail(error);
  return data ?? [];
}
export async function claimTrip(id: string) {
  const { error } = await supabase.rpc("rider_claim_trip", { p_trip_id: id });
  fail(error);
}
export async function respondAssignment(id: string, accept: boolean, reason?: string) {
  const { error } = await supabase.rpc("rider_respond_assignment", { p_trip_id: id, p_accept: accept, p_reason: reason ?? "" });
  fail(error);
}
export async function advanceTrip(id: string, to: "arriving" | "picked_up" | "in_progress" | "completed") {
  const { error } = await supabase.rpc("rider_advance_trip", { p_trip_id: id, p_to: to });
  fail(error);
}
export async function withdrawTrip(id: string, reason: string) {
  const { error } = await supabase.rpc("rider_withdraw_trip", { p_trip_id: id, p_reason: reason });
  fail(error);
}

/* ---------- admins ---------- */
export interface EligibleRider {
  user_id: string; full_name: string; vehicle_description: string; plate_number: string | null; busy: boolean;
  availability: "online" | "offline" | "busy"; has_pending_offer: boolean; fairness: import("./dispatch").FairnessBreakdown;
}
export async function adminListTrips(): Promise<Trip[]> {
  const { data, error } = await supabase.from("trips").select("*").order("created_at", { ascending: false }).limit(300);
  fail(error);
  return data ?? [];
}
export async function adminListEligibleRiders(): Promise<EligibleRider[]> {
  const { data, error } = await supabase.rpc("admin_list_eligible_riders");
  fail(error);
  return (data ?? []) as unknown as EligibleRider[];
}
export async function adminRiderNames(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("rider_applications").select("user_id,full_name,plate_number");
  fail(error);
  return Object.fromEntries((data ?? []).map((r) => [r.user_id, `${r.full_name}${r.plate_number ? ` · ${r.plate_number}` : ""}`]));
}
export async function adminAssignRider(tripId: string, riderId: string, override = false) {
  const { error } = await supabase.rpc("admin_assign_rider", { p_trip_id: tripId, p_rider_id: riderId, p_override: override });
  fail(error);
}
export async function adminCancelTrip(tripId: string, outcome: "cancelled_by_admin" | "no_show" | "expired", reason: string) {
  const { error } = await supabase.rpc("admin_cancel_trip", { p_trip_id: tripId, p_outcome: outcome, p_reason: reason });
  fail(error);
}
/* ---------- Phase 4: no-shows and stuck rides (all rules enforced in the database) ---------- */
export async function riderReportPassengerNoShow(tripId: string, reason: string) {
  const { error } = await supabase.rpc("rider_report_passenger_no_show", { p_trip_id: tripId, p_reason: reason });
  fail(error);
}
export async function passengerReportRiderLate(tripId: string, reason: string) {
  const { error } = await supabase.rpc("passenger_report_rider_late", { p_trip_id: tripId, p_reason: reason });
  fail(error);
}
export async function adminCompleteTrip(tripId: string, reason: string) {
  const { error } = await supabase.rpc("admin_complete_trip", { p_trip_id: tripId, p_reason: reason });
  fail(error);
}
export type TripIssue = "rider_late_reported" | "assignment_unanswered" | "rider_late" | "start_not_confirmed" | "completion_not_confirmed";
export const TRIP_ISSUE_LABEL: Record<TripIssue, string> = {
  rider_late_reported: "Passenger reported the rider hasn't arrived",
  assignment_unanswered: "Rider hasn't answered the assignment for 10+ min",
  rider_late: "Rider not at pickup 15+ min after departure time",
  start_not_confirmed: "Rider arrived 15+ min ago — no passenger has confirmed pickup",
  completion_not_confirmed: "At destination 15+ min — no passenger has confirmed completion",
};
export async function adminTripIssues(): Promise<Record<string, TripIssue[]>> {
  const { data, error } = await supabase.rpc("admin_trip_issues");
  fail(error);
  const out: Record<string, TripIssue[]> = {};
  for (const r of data ?? []) (out[r.trip_id] ??= []).push(r.issue as TripIssue);
  return out;
}
export async function getTripHistory(tripId: string): Promise<TripHistory[]> {
  const { data, error } = await supabase.from("trip_status_history").select("*").eq("trip_id", tripId).order("created_at");
  fail(error);
  return data ?? [];
}

export function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
}
