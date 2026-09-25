import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listAvailableRiders, requestRider } from "@/services/dispatch";
import { ratingText } from "@/services/ratings";

/** Optional: passengers may pick one of the riders Smart Dispatch already considers eligible. The database re-checks everything. */
export function AvailableRiders({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["available-riders", tripId], queryFn: () => listAvailableRiders(tripId), enabled: open, refetchInterval: open ? 10000 : false });
  const pick = useMutation({
    mutationFn: (riderId: string) => requestRider(tripId, riderId),
    onSettled: async () => {
      await Promise.all(["available-riders", "ride-group", "my-group-trips"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    },
  });
  if (!open) {
    return (
      <div className="mt-6">
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>See available riders</Button>
        <p className="mt-2 text-xs text-muted-foreground">Optional. FUTAMOVE keeps finding a rider for you automatically.</p>
      </div>
    );
  }
  const v = q.data;
  return (
    <section className="mt-6 surface-panel p-4">
      <div className="flex items-center justify-between">
        <p className="section-label">Available riders</p>
        <button type="button" className="text-xs text-muted-foreground" onClick={() => setOpen(false)}>Hide</button>
      </div>
      {q.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        : q.isError ? <p className="mt-3 text-sm text-destructive">{q.error.message}</p>
        : !v?.available ? <p className="mt-3 text-sm text-muted-foreground">A rider has already been found for this ride.</p>
        : v.riders.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No riders are free right now. We'll keep looking automatically.</p>
        : (
          <ul className="mt-3 divide-y divide-border">
            {v.riders.map((r) => (
              <li key={r.rider_id} className="flex items-center gap-3 py-3">
                {r.avatar_path ? <img src={r.avatar_path} alt={r.first_name} className="size-11 shrink-0 rounded-full object-cover" /> : <div className="grid size-11 shrink-0 place-items-center rounded-full bg-muted font-bold">{r.first_name[0]}</div>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.first_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{ratingText(r)}{r.distance_km != null ? ` · ~${r.distance_km} km away` : ""}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.vehicle}{r.plate ? ` · ${r.plate}` : ""}</p>
                </div>
                <Button size="sm" disabled={pick.isPending} onClick={() => pick.mutate(r.rider_id)}>
                  {pick.isPending && pick.variables === r.rider_id && <Loader2 className="animate-spin" />} Request
                </Button>
              </li>
            ))}
          </ul>
        )}
      {pick.error && <p className="mt-2 text-sm text-destructive">{pick.error.message}</p>}
      {pick.isSuccess && <p className="mt-2 text-sm text-success">Rider requested. They're confirming the ride.</p>}
    </section>
  );
}
