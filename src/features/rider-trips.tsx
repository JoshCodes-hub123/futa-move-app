import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, MapPin, Users } from "lucide-react";
import { AppShell } from "@/components/futamove/app-shell";
import { EmptyState, LoadingState, ScreenHeader, SectionHeading } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDepartureTime } from "@/services/ride-requests";
import {
  ACTIVE_TRIP_STATUSES, advanceTrip, claimTrip, isCancelled, listAvailableTrips, listMyRiderTrips, respondAssignment, withdrawTrip,
  type Trip, type TripStatus,
} from "@/services/trips";

const RIDER_LABEL: Record<TripStatus, string> = {
  confirmed: "Available", assigned: "Assigned to you", accepted: "Accepted", arriving: "Heading to pickup",
  picked_up: "Arrived · passengers on board", in_progress: "Trip started", completed: "Completed",
  cancelled_by_student: "Cancelled", cancelled_by_rider: "Cancelled", cancelled_by_admin: "Cancelled", expired: "Expired", no_show: "No-show",
};

function Route({ from, to, when, pax, note }: { from: string; to: string; when: string; pax: number; note?: string | null }) {
  return (
    <div className="space-y-1.5 text-sm">
      <p className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-brand" /> {from}</p>
      {note && <p className="pl-6 text-xs text-muted-foreground">{note}</p>}
      <p className="pl-6 font-semibold text-muted-foreground">↓ {to}</p>
      <p className="flex items-center gap-4 pl-6 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" /> {formatDepartureTime(when)}</span>
        <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {pax} {pax === 1 ? "passenger" : "passengers"}</span>
      </p>
    </div>
  );
}

function CurrentTrip({ trip, onDone }: { trip: Trip; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const s = trip.status as TripStatus;
  const act = useMutation({
    mutationFn: async (a: "accept" | "reject" | "arriving" | "picked_up" | "in_progress" | "completed" | "withdraw") => {
      if (a === "accept") return respondAssignment(trip.id, true);
      if (a === "reject") return respondAssignment(trip.id, false, reason);
      if (a === "withdraw") return withdrawTrip(trip.id, reason);
      return advanceTrip(trip.id, a);
    },
    onSuccess: async () => { setReason(""); setWithdrawing(false); await onDone(); },
    onError: onDone,
  });
  const next: Partial<Record<TripStatus, { to: "arriving" | "picked_up" | "in_progress" | "completed"; label: string }>> = {
    accepted: { to: "arriving", label: "Head to meeting point" },
    arriving: { to: "picked_up", label: "I've arrived" },
    picked_up: { to: "in_progress", label: "Start ride" },
    in_progress: { to: "completed", label: "Complete ride" },
  };
  const step = next[s];
  return (
    <section className="mt-8 surface-panel p-5">
      <div className="flex items-center justify-between">
        <p className="section-label">My current ride</p>
        <Badge variant="warning" className="rounded-full">{RIDER_LABEL[s]}</Badge>
      </div>
      <div className="mt-4"><Route from={trip.meeting_point_text} to={trip.destination_text} when={trip.departure_time} pax={trip.passenger_count} note={trip.meeting_point_note} /></div>
      <p className="mt-3 text-xs text-muted-foreground">{trip.member_count} {trip.member_count === 1 ? "booking" : "bookings"} in this group · pickup at the agreed meeting point</p>
      {act.error && <p className="mt-4 text-sm text-destructive">{act.error.message}</p>}
      <div className="mt-5 grid gap-3">
        {s === "assigned" && (
          <>
            <Button size="lg" onClick={() => act.mutate("accept")} disabled={act.isPending}>{act.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Accept ride</Button>
            <Input placeholder="Reason for rejecting (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="secondary" onClick={() => act.mutate("reject")} disabled={act.isPending}>Reject</Button>
          </>
        )}
        {step && <Button size="lg" onClick={() => act.mutate(step.to)} disabled={act.isPending}>{act.isPending && <Loader2 className="animate-spin" />}{step.label}</Button>}
        {(s === "accepted" || s === "arriving") && (withdrawing ? (
          <>
            <Input placeholder="Why can't you take this ride?" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="secondary" onClick={() => act.mutate("withdraw")} disabled={act.isPending || !reason.trim()}>Confirm withdrawal</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setWithdrawing(true)}>I can't make this ride</Button>
        ))}
      </div>
    </section>
  );
}

/** Rider home: current ride + available confirmed rides. */
export function RiderOperations() {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ["rider-trips"], queryFn: listMyRiderTrips, refetchInterval: 8000 });
  const available = useQuery({ queryKey: ["rider-available"], queryFn: listAvailableTrips, refetchInterval: 8000 });
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["rider-trips"] }); await qc.invalidateQueries({ queryKey: ["rider-available"] }); };
  const claim = useMutation({ mutationFn: claimTrip, onSuccess: refresh, onError: refresh });
  const current = mine.data?.find((t) => ACTIVE_TRIP_STATUSES.includes(t.status as TripStatus));

  return (
    <>
      {mine.isLoading ? <LoadingState /> : current ? <CurrentTrip trip={current} onDone={refresh} /> : (
        <section className="mt-8 surface-panel p-5 text-sm"><p className="section-label">Status</p><p className="mt-2">You're available. Accept a ride below or wait for FUTAMOVE to assign one.</p></section>
      )}
      <section className="mt-10 space-y-3">
        <SectionHeading title="Available rides" detail={String(available.data?.length ?? 0)} />
        {claim.error && <p className="text-sm text-destructive">{claim.error.message}</p>}
        {available.isLoading ? <LoadingState /> : available.data?.length ? (
          <div className="divider-list">
            {available.data.map((t) => (
              <div key={t.id} className="py-4">
                <Route from={t.meeting_point_text} to={t.destination_text} when={t.departure_time} pax={t.passenger_count} note={t.meeting_point_note} />
                <Button className="mt-3 w-full" size="sm" disabled={!!current || claim.isPending} onClick={() => claim.mutate(t.id)}>
                  {current ? "Finish your current ride first" : "Accept ride"}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface-panel"><EmptyState compact title="No rides waiting" description="Confirmed student groups will appear here." icon={CalendarClock} /></div>
        )}
      </section>
    </>
  );
}

export function RiderTripsPage() {
  const mine = useQuery({ queryKey: ["rider-trips"], queryFn: listMyRiderTrips });
  const past = (mine.data ?? []).filter((t) => t.status === "completed" || isCancelled(t.status));
  return (
    <AppShell role="rider">
      <ScreenHeader title="Trips" />
      <section className="mt-8">
        {mine.isLoading ? <LoadingState /> : past.length ? (
          <div className="divider-list">
            {past.map((t) => (
              <div key={t.id} className="py-4">
                <div className="mb-2 flex justify-between"><Badge variant={t.status === "completed" ? "success" : "outline"} className="rounded-full">{RIDER_LABEL[t.status as TripStatus]}</Badge>
                  <span className="text-xs text-muted-foreground">{t.completed_at ? new Date(t.completed_at).toLocaleString() : t.cancelled_at ? new Date(t.cancelled_at).toLocaleString() : ""}</span></div>
                <Route from={t.meeting_point_text} to={t.destination_text} when={t.departure_time} pax={t.passenger_count} />
              </div>
            ))}
          </div>
        ) : <div className="surface-panel"><EmptyState compact title="No trips yet" description="Completed and cancelled trips will show here." icon={CalendarClock} /></div>}
      </section>
    </AppShell>
  );
}
