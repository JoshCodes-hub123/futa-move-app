import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminFrame } from "@/features/admin-console";
import {
  ADMIN_TRIP_LABEL, adminAssignRider, adminCancelTrip, adminListEligibleRiders, adminListTrips, adminRiderNames, fmtTime, getTripHistory,
  isCancelled, isTerminal, type Trip, type TripStatus,
} from "@/services/trips";

const FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "pending", label: "Pending assignment", match: (s) => s === "confirmed" },
  { key: "assigned", label: "Assigned", match: (s) => s === "assigned" },
  { key: "accepted", label: "Accepted", match: (s) => s === "accepted" },
  { key: "arriving", label: "Arriving", match: (s) => s === "arriving" },
  { key: "progress", label: "In progress", match: (s) => s === "picked_up" || s === "in_progress" },
  { key: "completed", label: "Completed", match: (s) => s === "completed" },
  { key: "cancelled", label: "Cancelled", match: (s) => isCancelled(s) },
  { key: "all", label: "All", match: () => true },
];

function TripCard({ t, riderName, onChanged }: { t: Trip; riderName?: string | undefined; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rider, setRider] = useState("");
  const [outcome, setOutcome] = useState<"cancelled_by_admin" | "no_show" | "expired">("cancelled_by_admin");
  const [reason, setReason] = useState("");
  const s = t.status as TripStatus;
  const riders = useQuery({ queryKey: ["eligible-riders"], queryFn: adminListEligibleRiders, enabled: open });
  const history = useQuery({ queryKey: ["trip-history", t.id], queryFn: () => getTripHistory(t.id), enabled: open });
  const assign = useMutation({ mutationFn: () => adminAssignRider(t.id, rider), onSuccess: async () => { setRider(""); await onChanged(); await history.refetch(); } });
  const cancel = useMutation({ mutationFn: () => adminCancelTrip(t.id, outcome, reason), onSuccess: async () => { setReason(""); await onChanged(); await history.refetch(); } });
  const canAssign = s === "confirmed" || s === "assigned" || s === "accepted";
  const err = assign.error ?? cancel.error;

  return (
    <div className="surface-panel p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{t.meeting_point_text} → {t.destination_text}</p>
          <p className="text-xs text-muted-foreground">Departs {fmtTime(t.departure_time)} · {t.passenger_count} passengers in {t.member_count} bookings · Trip {t.id.slice(0, 8)} · Group {t.group_id.slice(0, 8)}</p>
          <p className="mt-1 text-xs">Rider: {riderName ?? (t.rider_id ? t.rider_id.slice(0, 8) : "None")}</p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold">{ADMIN_TRIP_LABEL[s]}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Confirmed {fmtTime(t.confirmed_at)} · Assigned {fmtTime(t.assigned_at)} · Accepted {fmtTime(t.accepted_at)} · Arriving {fmtTime(t.arriving_at)} · Picked up {fmtTime(t.picked_up_at)} · Started {fmtTime(t.started_at)} · Completed {fmtTime(t.completed_at)}
        {t.cancelled_at && ` · Cancelled ${fmtTime(t.cancelled_at)} (${t.cancel_reason ?? "no reason"}, was ${t.cancelled_from_status})`}
      </p>
      <Button variant="ghost" size="sm" className="mt-2 px-0" onClick={() => setOpen(!open)}>{open ? "Hide details" : "Manage & history"}</Button>
      {open && (
        <div className="mt-3 space-y-4 border-t border-border pt-4">
          {canAssign && (
            <div className="flex flex-wrap gap-2">
              <select className="h-10 min-w-56 rounded-md border border-input bg-background px-3" value={rider} onChange={(e) => setRider(e.target.value)}>
                <option value="">{riders.isLoading ? "Loading riders…" : "Choose an approved rider"}</option>
                {riders.data?.map((r) => (
                  <option key={r.user_id} value={r.user_id} disabled={r.busy || r.user_id === t.rider_id}>
                    {r.full_name}{r.plate_number ? ` · ${r.plate_number}` : ""}{r.busy ? " (on a ride)" : ""}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={!rider || assign.isPending} onClick={() => assign.mutate()}>{t.rider_id ? "Reassign rider" : "Assign rider"}</Button>
            </div>
          )}
          {!isTerminal(s) && (
            <div className="flex flex-wrap gap-2">
              <select className="h-10 rounded-md border border-input bg-background px-3" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                <option value="cancelled_by_admin">Cancel ride</option>
                <option value="no_show">No-show</option>
                <option value="expired">Expired</option>
              </select>
              <Input className="max-w-xs" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>Apply</Button>
            </div>
          )}
          {err && <p className="text-destructive">{err.message}</p>}
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
  const [filter, setFilter] = useState("pending");
  const trips = useQuery({ queryKey: ["admin-trips"], queryFn: adminListTrips, refetchInterval: 10000 });
  const names = useQuery({ queryKey: ["admin-rider-names"], queryFn: adminRiderNames });
  const f = FILTERS.find((x) => x.key === filter)!;
  const rows = (trips.data ?? []).filter((t) => f.match(t.status));
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["admin-trips"] }); await qc.invalidateQueries({ queryKey: ["eligible-riders"] }); };
  return (
    <AdminFrame title="Rides" intro="Confirmed student groups, rider assignment and trip history.">
      <div className="mt-6 flex flex-wrap gap-1">
        {FILTERS.map((x) => (
          <button key={x.key} type="button" onClick={() => setFilter(x.key)}
            className={`rounded-full px-3 py-1.5 text-sm ${filter === x.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            {x.label} ({(trips.data ?? []).filter((t) => x.match(t.status)).length})
          </button>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {trips.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : trips.isError ? <p className="text-sm text-destructive">{trips.error.message}</p>
          : rows.length ? rows.map((t) => <TripCard key={t.id} t={t} riderName={t.rider_id ? names.data?.[t.rider_id] : undefined} onChanged={refresh} />)
          : <p className="text-sm text-muted-foreground">No rides here.</p>}
      </div>
    </AdminFrame>
  );
}
