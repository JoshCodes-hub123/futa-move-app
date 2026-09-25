import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminTripPassengers } from "@/services/admin-ops";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminFrame } from "@/features/admin-console";
import {
  ADMIN_TRIP_LABEL, TRIP_ISSUE_LABEL, adminAssignRider, adminCompleteTrip, adminTripIssues, adminCancelTrip, adminListEligibleRiders, adminListTrips, adminRiderNames, fmtTime, getTripHistory,
  isCancelled, isTerminal, type Trip, type TripStatus,
} from "@/services/trips";
import {
  DISPATCH_STATE_LABEL, EVENT_LABEL, adminDispatchOverview, adminMarkRiderNoShow, adminRedispatch, adminTripDispatch, adminTripParticipants, fmtWait,
  type DispatchOverviewRow, type DispatchState, type FairnessBreakdown, type TripParticipants,
} from "@/services/dispatch";

const waitingForRider = (t: Trip) => t.status === "confirmed" && !t.rider_id;
const FILTERS: { key: string; label: string; match: (t: Trip) => boolean }[] = [
  { key: "attention", label: "Needs admin attention", match: (t) => waitingForRider(t) && t.dispatch_state === "escalated" },
  { key: "waiting", label: "Waiting for rider", match: (t) => waitingForRider(t) && t.dispatch_state === "searching" },
  { key: "offer", label: "Offer pending", match: (t) => waitingForRider(t) && t.dispatch_state === "offer_pending" },
  { key: "assigned", label: "Assigned", match: (t) => t.status === "assigned" },
  { key: "accepted", label: "Accepted", match: (t) => t.status === "accepted" },
  { key: "arriving", label: "Arriving", match: (t) => t.status === "arriving" },
  { key: "progress", label: "In progress", match: (t) => t.status === "picked_up" || t.status === "in_progress" },
  { key: "completed", label: "Completed", match: (t) => t.status === "completed" },
  { key: "cancelled", label: "Cancelled", match: (t) => isCancelled(t.status) },
  { key: "all", label: "All", match: () => true },
];

export function Explain({ b }: { b: FairnessBreakdown }) {
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-3">
      <div><p className="font-semibold">Eligibility</p>{(b.eligibility ?? ["Approved rider", "Online", "No active trip"]).map((x) => <p key={x}>✓ {x}</p>)}</div>
      <div><p className="font-semibold">Suitability</p>{(b.suitability ?? []).map((x) => <p key={x}>✓ {x}</p>)}<p className="text-muted-foreground">Distance: {b.proximity ?? "not available"}</p></div>
      <div>
        <p className="font-semibold">Fairness (last {b.window_days} days)</p>
        <p>{b.completed_today} rides completed today · {b.completed_window} in window</p>
        <p>{b.offers_today} offers received today</p>
        <p>{b.hours_since_last_completed >= 24 ? "24h+" : `${b.hours_since_last_completed}h`} since last completed ride</p>
        <p>Declines {b.declines_window} · Timeouts {b.timeouts_window} · Withdrawals {b.withdrawals_window} · No-shows {b.no_shows_window}</p>
        <p className="font-semibold">Score {b.score}</p>
      </div>
    </div>
  );
}

function DispatchDetail({ tripId }: { tripId: string }) {
  const d = useQuery({ queryKey: ["trip-dispatch", tripId], queryFn: () => adminTripDispatch(tripId), refetchInterval: 10000 });
  if (d.isLoading) return <p className="text-xs text-muted-foreground">Loading dispatch…</p>;
  if (d.isError) return <p className="text-xs text-destructive">{d.error.message}</p>;
  const v = d.data!;
  return (
    <div className="space-y-4">
      <div>
        <p className="section-label">Offers</p>
        {v.offers.length ? v.offers.map((o) => (
          <details key={o.id} className="mt-2 rounded-md border border-border p-2 text-xs">
            <summary className="cursor-pointer">{fmtTime(o.offered_at)} — {o.rider_name ?? o.rider_id.slice(0, 8)} · <b>{o.response}</b>{o.response_reason ? ` (${o.response_reason})` : ""} · score {o.score ?? "—"} · why selected?</summary>
            {o.reason && <div className="mt-2"><Explain b={o.reason} /></div>}
          </details>
        )) : <p className="mt-1 text-xs text-muted-foreground">No offers yet.</p>}
      </div>
      {v.candidates.length > 0 && (
        <div>
          <p className="section-label">Current candidates (best first)</p>
          {v.candidates.map((c, i) => (
            <details key={c.rider_id} className="mt-2 rounded-md border border-border p-2 text-xs">
              <summary className="cursor-pointer">#{i + 1} {c.rider_name ?? c.rider_id.slice(0, 8)} · score {c.score}</summary>
              <div className="mt-2"><Explain b={c.breakdown} /></div>
            </details>
          ))}
        </div>
      )}
      <div>
        <p className="section-label">Dispatch history</p>
        <ol className="mt-2 space-y-1 text-xs">
          {v.events.map((e) => (
            <li key={e.id}>{fmtTime(e.created_at)} — {EVENT_LABEL[e.event_type] ?? e.event_type}{e.rider_name ? ` · ${e.rider_name}` : ""} · by {e.actor_role}
              {e.reason && typeof e.reason === "object" && !Array.isArray(e.reason) && ("why" in e.reason || "reason" in e.reason) ? ` · ${String((e.reason as Record<string, unknown>)["why"] ?? (e.reason as Record<string, unknown>)["reason"] ?? "")}` : ""}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function whyWaiting(t: Trip, d?: DispatchOverviewRow, p?: TripParticipants): string | null {
  if (isTerminal(t.status as TripStatus)) return null;
  if (waitingForRider(t)) {
    if (t.dispatch_state === "escalated") return "Escalated to admin";
    if (d?.pending_rider_id) return "Rider offer pending";
    if (d && d.offers_total > 0) return (d.candidate_count ?? 0) > 0 ? "Retrying with the next rider" : "Previous offers declined/expired — no free rider now";
    return (d?.candidate_count ?? 0) > 0 ? "Waiting for rider assignment" : "Waiting — no eligible rider online";
  }
  if (t.status === "assigned") return "Assigned — waiting for rider to accept";
  if (t.status === "accepted") return "Rider accepted";
  if (t.status === "arriving") return "Rider arriving";
  if (t.status === "picked_up") return p?.passenger_pickup_confirms ? "Starting" : "Rider arrived — passenger confirmation pending";
  if (t.status === "in_progress") return p?.rider_at_destination ? "At destination — completion confirmation pending" : "In progress";
  return null;
}

function TripCard({ t, riderName, passengers, dispatch, parts, onChanged }: { t: Trip; riderName?: string | undefined; passengers?: string | undefined; dispatch?: DispatchOverviewRow | undefined; parts?: TripParticipants | undefined; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rider, setRider] = useState("");
  const [override, setOverride] = useState(false);
  const [outcome, setOutcome] = useState<"cancelled_by_admin" | "no_show" | "expired" | "rider_no_show">("cancelled_by_admin");
  const [reason, setReason] = useState("");
  const s = t.status as TripStatus;
  const riders = useQuery({ queryKey: ["eligible-riders"], queryFn: adminListEligibleRiders, enabled: open });
  const history = useQuery({ queryKey: ["trip-history", t.id], queryFn: () => getTripHistory(t.id), enabled: open });
  const after = async () => { await onChanged(); await history.refetch(); };
  const assign = useMutation({ mutationFn: () => adminAssignRider(t.id, rider, override), onSuccess: async () => { setRider(""); setOverride(false); await after(); }, onError: after });
  const cancel = useMutation({
    mutationFn: () => (outcome === "rider_no_show" ? adminMarkRiderNoShow(t.id, reason) : adminCancelTrip(t.id, outcome, reason)),
    onSuccess: async () => { setReason(""); await after(); }, onError: after,
  });
  const redispatch = useMutation({ mutationFn: () => adminRedispatch(t.id), onSuccess: after, onError: after });
  const issuesQ = useQuery({ queryKey: ["admin-trip-issues"], queryFn: adminTripIssues, refetchInterval: 15000 });
  const issues = issuesQ.data?.[t.id] ?? [];
  const complete = useMutation({ mutationFn: () => adminCompleteTrip(t.id, reason), onSuccess: async () => { setReason(""); await issuesQ.refetch(); await after(); }, onError: after });
  const canAssign = s === "confirmed" || s === "assigned" || s === "accepted";
  const riderOnTrip = !!t.rider_id && (s === "assigned" || s === "accepted" || s === "arriving");
  const err = assign.error ?? cancel.error ?? redispatch.error ?? complete.error;
  const chosen = riders.data?.find((r) => r.user_id === rider);
  const ds = t.dispatch_state as DispatchState;
  const why = whyWaiting(t, dispatch, parts);

  return (
    <div className={`surface-panel p-4 text-sm ${ds === "escalated" && waitingForRider(t) ? "border-destructive/60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold">{t.meeting_point_text} → {t.destination_text}</p>
          <p className="text-xs text-muted-foreground">Departs {fmtTime(t.departure_time)} · {t.passenger_count} passengers in {t.member_count} bookings · Trip {t.id.slice(0, 8)}</p>
          {parts && <p className="text-xs text-muted-foreground">{parts.students} student{parts.students === 1 ? "" : "s"} · {parts.lecturers} lecturer{parts.lecturers === 1 ? "" : "s"}</p>}
          {passengers && <p className="break-words text-xs">Passengers: {passengers}</p>}
          <p className="mt-1 text-xs">Rider: {riderName ?? (t.rider_id ? t.rider_id.slice(0, 8) : "None")}{parts?.rider_availability ? ` (${parts.rider_availability})` : ""}{parts?.assignment_method ? ` · via ${parts.assignment_method}` : ""}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold">{ADMIN_TRIP_LABEL[s]}</span>
          {waitingForRider(t) && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ds === "escalated" ? "bg-destructive/15 text-destructive" : "bg-muted"}`}>{DISPATCH_STATE_LABEL[ds]}</span>}
        </div>
      </div>
      {why && <p className="mt-2 text-xs font-semibold">Now: {why}</p>}
      {dispatch && waitingForRider(t) && (
        <p className="mt-2 text-xs">
          Waiting {fmtWait(dispatch.waiting_seconds)} · {dispatch.offers_total} riders offered ({dispatch.offers_declined} declined, {dispatch.offers_timed_out} timed out, {dispatch.offers_cancelled} cancelled)
          · {dispatch.candidate_count ?? 0} eligible now
          {dispatch.pending_expires_at && ` · current offer expires ${new Date(dispatch.pending_expires_at).toLocaleTimeString()}`}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Confirmed {fmtTime(t.confirmed_at)} · Assigned {fmtTime(t.assigned_at)} · Accepted {fmtTime(t.accepted_at)} · Arriving {fmtTime(t.arriving_at)} · Picked up {fmtTime(t.picked_up_at)} · Started {fmtTime(t.started_at)} · Completed {fmtTime(t.completed_at)}
        {t.cancelled_at && ` · Cancelled ${fmtTime(t.cancelled_at)} (${t.cancel_reason ?? "no reason"}, was ${t.cancelled_from_status})`}
      </p>
      {issues.length > 0 && (
        <div className="mt-2 rounded-md border border-destructive/60 p-2 text-xs">
          <p className="font-semibold text-destructive">Needs admin action</p>
          {issues.map((i) => <p key={i}>• {TRIP_ISSUE_LABEL[i]}</p>)}
          <p className="mt-1 text-muted-foreground">Open "Manage, dispatch & history" to reassign, mark a no-show, cancel with a reason, or complete an arrived ride. Every action is recorded with your name.</p>
        </div>
      )}
      <Button variant="ghost" size="sm" className="mt-2 px-0" onClick={() => setOpen(!open)}>{open ? "Hide details" : "Manage, dispatch & history"}</Button>
      {open && (
        <div className="mt-3 space-y-4 border-t border-border pt-4">
          {canAssign && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <select className="h-10 min-w-56 rounded-md border border-input bg-background px-3" value={rider} onChange={(e) => setRider(e.target.value)}>
                  <option value="">{riders.isLoading ? "Loading riders…" : "Choose an approved rider"}</option>
                  {riders.data?.map((r) => (
                    <option key={r.user_id} value={r.user_id} disabled={r.busy || r.user_id === t.rider_id}>
                      {r.full_name}{r.plate_number ? ` · ${r.plate_number}` : ""} · {r.busy ? "on a ride" : r.availability} · score {r.fairness.score}
                    </option>
                  ))}
                </select>
                <Button size="sm" disabled={!rider || assign.isPending} onClick={() => assign.mutate()}>{t.rider_id ? "Reassign rider" : "Assign rider"}</Button>
              </div>
              {chosen && chosen.availability !== "online" && (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Emergency override — this rider is {chosen.availability}. Assign anyway.
                </label>
              )}
            </div>
          )}
          {waitingForRider(t) && (
            <Button size="sm" variant="secondary" disabled={redispatch.isPending} onClick={() => redispatch.mutate()}>Restart automatic dispatch</Button>
          )}
          {!isTerminal(s) && (
            <div className="flex flex-wrap gap-2">
              <select className="h-10 rounded-md border border-input bg-background px-3" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                <option value="cancelled_by_admin">Cancel ride</option>
                <option value="no_show">Students no-show</option>
                <option value="expired">Expired</option>
                {riderOnTrip && <option value="rider_no_show">Rider no-show (find another rider)</option>}
              </select>
              <Input className="max-w-xs" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>Apply</Button>
            </div>
          )}
          {s === "in_progress" && parts?.rider_at_destination && (
            <Button size="sm" variant="secondary" disabled={!reason.trim() || complete.isPending} onClick={() => complete.mutate()}>Mark ride completed (uses the reason above)</Button>
          )}
          {err && <p className="text-destructive">{err.message}</p>}
          <DispatchDetail tripId={t.id} />
          <div>
            <p className="section-label">Status history</p>
            <ol className="mt-2 space-y-1 text-xs">
              {history.data?.map((h) => (
                <li key={h.id}>{fmtTime(h.created_at)} — {h.from_status ?? "created"} → {h.to_status} by {h.actor_role ?? "system"}{h.reason ? ` · ${h.reason}` : ""}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminRidesPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("attention");
  const [search, setSearch] = useState("");
  const [day, setDay] = useState("");
  const trips = useQuery({ queryKey: ["admin-trips"], queryFn: adminListTrips, refetchInterval: 15000 });
  const overview = useQuery({ queryKey: ["admin-dispatch-overview"], queryFn: adminDispatchOverview, refetchInterval: 15000 });
  const names = useQuery({ queryKey: ["admin-rider-names"], queryFn: adminRiderNames });
  const parts = useQuery({ queryKey: ["admin-trip-participants"], queryFn: adminTripParticipants, refetchInterval: 15000 });
  const issues = useQuery({ queryKey: ["admin-trip-issues"], queryFn: adminTripIssues, refetchInterval: 15000 });
  const pax = useQuery({ queryKey: ["admin-trip-passengers"], queryFn: adminTripPassengers, refetchInterval: 60000 });
  const needsAction = (t: Trip) => (waitingForRider(t) && t.dispatch_state === "escalated") || (issues.data?.[t.id]?.length ?? 0) > 0;
  const filters = [
    { key: "attention", label: "Needs admin action", match: needsAction },
    { key: "active", label: "Active", match: (t: Trip) => !isTerminal(t.status) },
    ...FILTERS.filter((x) => x.key !== "attention" && x.key !== "all"),
    { key: "noshow", label: "No-show", match: (t: Trip) => t.status === "no_show" },
    { key: "all", label: "All", match: () => true },
  ];
  const f = filters.find((x) => x.key === filter) ?? filters[0]!;
  const term = search.trim().toLowerCase();
  const base = (trips.data ?? []).filter((t) => {
    if (day && new Date(t.departure_time).toLocaleDateString("en-CA") !== day) return false;
    if (!term) return true;
    const hay = [t.meeting_point_text, t.destination_text, t.id, t.rider_id ? names.data?.[t.rider_id] : "", pax.data?.[t.id]].join(" ").toLowerCase();
    return hay.includes(term);
  });
  const rows = base.filter(f.match);
  const refresh = async () => {
    await Promise.all(["admin-trips", "admin-dispatch-overview", "admin-trip-participants", "admin-trip-issues", "eligible-riders", "trip-dispatch", "admin-ops-overview"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
  return (
    <AdminFrame title="Rides" intro="Confirmed groups, automatic dispatch, rider assignment and trip history. Refreshes every 15 seconds.">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input placeholder="Search rider, passenger, place or trip ID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search rides" />
        <div className="flex gap-2">
          <Input type="date" className="w-auto" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Departure date" />
          {(day || search) && <Button variant="ghost" onClick={() => { setDay(""); setSearch(""); }}>Clear</Button>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1">
        {filters.map((x) => {
          const n = base.filter(x.match).length;
          const hot = x.key === "attention" && n > 0;
          return (
            <button key={x.key} type="button" onClick={() => setFilter(x.key)}
              className={`min-h-9 rounded-full px-3 py-1.5 text-sm ${filter === x.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted"} ${hot ? "text-destructive" : ""}`}>
              {x.label} ({n})
            </button>
          );
        })}
      </div>
      <div className="mt-6 space-y-3">
        {trips.isLoading ? <p className="text-sm text-muted-foreground">Loading rides…</p>
          : trips.isError ? <div className="text-sm"><p className="text-destructive">{trips.error.message}</p><Button size="sm" variant="secondary" className="mt-2" onClick={() => void trips.refetch()}>Try again</Button></div>
          : rows.length ? rows.map((t) => <TripCard key={t.id} t={t} riderName={t.rider_id ? names.data?.[t.rider_id] : undefined} passengers={pax.data?.[t.id]} dispatch={overview.data?.[t.id]} parts={parts.data?.[t.id]} onChanged={refresh} />)
          : <p className="text-sm text-muted-foreground">{filter === "attention" && !term && !day ? "Nothing needs admin action right now." : "No rides match these filters."}</p>}
      </div>
    </AdminFrame>
  );
}
