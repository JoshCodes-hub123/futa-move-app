import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IMPROVE_TAGS, POSITIVE_TAGS, confirmCompletion, confirmPickup, getTripRiderProfile, rateRider, ratingText } from "@/services/ratings";

/** Rider card, pickup confirmation and post-ride rating for a passenger. All rules are enforced by the database. */
export function TripRiderCard({ tripId, status }: { tripId: string; status: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["trip-rider", tripId, status], queryFn: () => getTripRiderProfile(tripId), refetchInterval: 10000 });
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["trip-rider", tripId] }); await qc.invalidateQueries({ queryKey: ["ride-group"] }); await qc.invalidateQueries({ queryKey: ["my-group-trips"] }); };
  const confirm = useMutation({ mutationFn: () => confirmPickup(tripId), onSuccess: refresh });
  const complete = useMutation({ mutationFn: () => confirmCompletion(tripId), onSuccess: refresh });
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const rate = useMutation({ mutationFn: () => rateRider(tripId, stars, tags), onSuccess: refresh });
  const p = q.data;
  if (!p) return null;
  const pick = p.confirmations.filter((c) => c.type === "pickup_start");
  const riderConfirmed = pick.some((c) => c.role === "rider");
  const iConfirmed = pick.some((c) => c.is_me);
  const passengerCount = pick.filter((c) => c.role === "passenger").length;
  const riderAtDestination = p.confirmations.some((c) => c.type === "destination_arrival");
  const iConfirmedCompletion = p.confirmations.some((c) => c.type === "completion" && c.is_me);
  const toggle = (t: string) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));

  return (
    <section className="mt-6 surface-panel p-4">
      <p className="section-label">Your rider</p>
      <div className="mt-3 flex items-center gap-3">
        {p.avatar_path ? <img src={p.avatar_path} alt={p.first_name} className="size-12 rounded-full object-cover" /> : <div className="grid size-12 place-items-center rounded-full bg-muted font-bold">{p.first_name[0]}</div>}
        <div className="min-w-0">
          <p className="text-sm font-semibold">{p.first_name}</p>
          <p className="text-xs text-muted-foreground">{ratingText(p)}{p.distance_km != null ? ` · ~${p.distance_km} km away` : ""}</p>
          <p className="text-xs text-muted-foreground">{p.vehicle}{p.plate ? ` · ${p.plate}` : ""}</p>
        </div>
      </div>

      {status === "in_progress" && riderAtDestination && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-semibold">You've reached your destination. Confirm ride completed.</p>
          <p className="mt-1 text-xs text-muted-foreground">Arrived — waiting for passenger confirmation. One passenger confirming is enough.</p>
          {complete.error && <p className="mt-2 text-sm text-destructive">{complete.error.message}</p>}
          <Button className="mt-3 w-full" onClick={() => complete.mutate()} disabled={complete.isPending}>
            {complete.isPending && <Loader2 className="animate-spin" />} Confirm ride completed
          </Button>
        </div>
      )}

      {(status === "picked_up" || (status === "in_progress" && !riderAtDestination)) && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-semibold">{status === "picked_up" ? "Your rider has arrived" : "Ride started"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Rider {riderConfirmed ? "✓ confirmed" : "waiting"} · Passengers confirmed: {passengerCount}. The ride starts once the rider and one passenger confirm.
          </p>
          {confirm.error && <p className="mt-2 text-sm text-destructive">{confirm.error.message}</p>}
          {iConfirmed ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> You confirmed pickup</p>
          ) : (
            <Button className="mt-3 w-full" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
              {confirm.isPending && <Loader2 className="animate-spin" />} I'm in the keke
            </Button>
          )}
        </div>
      )}

      {status === "completed" && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="size-4" /> Ride completed</p>
          {riderAtDestination && !iConfirmedCompletion && (
            <Button variant="secondary" className="mb-3 w-full" onClick={() => complete.mutate()} disabled={complete.isPending}>I also reached my destination</Button>
          )}
          {p.my_rating ? (
            <p className="text-sm">You rated this ride {p.my_rating} ★. Thank you.</p>
          ) : (
            <>
              <p className="text-sm font-semibold">How was your ride?</p>
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-label={`${n} stars`} onClick={() => setStars(n)}>
                    <Star className={`size-7 ${n <= stars ? "fill-brand text-brand" : "text-muted-foreground"}`} />
                  </button>
                ))}
              </div>
              {stars > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(stars >= 4 ? POSITIVE_TAGS : [...POSITIVE_TAGS, ...IMPROVE_TAGS]).map((t) => (
                    <button key={t} type="button" onClick={() => toggle(t)}
                      className={`rounded-full border px-3 py-1 text-xs ${tags.includes(t) ? "border-foreground bg-foreground text-background" : "border-border"}`}>{t}</button>
                  ))}
                </div>
              )}
              {rate.error && <p className="mt-2 text-sm text-destructive">{rate.error.message}</p>}
              <Button className="mt-3 w-full" disabled={!stars || rate.isPending} onClick={() => rate.mutate()}>
                {rate.isPending && <Loader2 className="animate-spin" />} Submit rating
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
