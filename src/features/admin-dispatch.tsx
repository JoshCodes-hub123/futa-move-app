import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminFrame } from "@/features/admin-console";
import { Explain } from "@/features/admin-rides";
import { adminListEligibleRiders } from "@/services/trips";
import { getDispatchSettings, updateDispatchSettings } from "@/services/dispatch";

const WEIGHTS: { key: string; label: string }[] = [
  { key: "base", label: "Starting score" },
  { key: "completed_today", label: "Minus per ride completed today" },
  { key: "completed_window", label: "Minus per ride completed in window" },
  { key: "offers_today", label: "Minus per offer received today" },
  { key: "decline", label: "Minus per decline" },
  { key: "timeout", label: "Minus per timeout" },
  { key: "withdrawal", label: "Minus per withdrawal after accepting" },
  { key: "no_show", label: "Minus per rider no-show" },
  { key: "idle_hour", label: "Plus per hour since last ride (max 24)" },
  { key: "offer_idle_hour", label: "Plus per hour since last offer (max 24)" },
  { key: "proximity", label: "Closeness bonus (full at meeting point, 0 beyond 3 km)" },
];

function SettingsForm() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["dispatch-settings"], queryFn: getDispatchSettings });
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!s.data) return;
    const w = s.data.weights as Record<string, number>;
    setForm({
      offer_timeout_seconds: String(s.data.offer_timeout_seconds), max_offers: String(s.data.max_offers),
      fairness_window_days: String(s.data.fairness_window_days), escalate_after_seconds: String(s.data.escalate_after_seconds),
      ...Object.fromEntries(WEIGHTS.map((x) => [`w_${x.key}`, String(w[x.key] ?? 0)])),
    });
  }, [s.data]);
  const save = useMutation({
    mutationFn: () => updateDispatchSettings({
      offer_timeout_seconds: Number(form["offer_timeout_seconds"]), max_offers: Number(form["max_offers"]),
      fairness_window_days: Number(form["fairness_window_days"]), escalate_after_seconds: Number(form["escalate_after_seconds"]),
      weights: Object.fromEntries(WEIGHTS.map((x) => [x.key, Number(form[`w_${x.key}`])])),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dispatch-settings"] }),
  });
  const field = (k: string, label: string) => (
    <label key={k} className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input type="number" value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </label>
  );
  if (s.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <section className="surface-panel p-4">
      <p className="section-label">Dispatch settings</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field("offer_timeout_seconds", "Seconds a rider has to answer an offer (20–600)")}
        {field("max_offers", "Offers before escalating to admin (1–20)")}
        {field("fairness_window_days", "Fairness window in days (1–30)")}
        {field("escalate_after_seconds", "Escalate if no rider found after (seconds, 60–3600)")}
      </div>
      <p className="section-label mt-5">Fairness weights</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{WEIGHTS.map((x) => field(`w_${x.key}`, x.label))}</div>
      {save.error && <p className="mt-3 text-sm text-destructive">{save.error.message}</p>}
      {save.isSuccess && <p className="mt-3 text-sm text-success">Saved.</p>}
      <Button className="mt-4" disabled={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
    </section>
  );
}

export function AdminDispatchPage() {
  const riders = useQuery({ queryKey: ["eligible-riders"], queryFn: adminListEligibleRiders, refetchInterval: 20000 });
  const online = riders.data?.filter((r) => r.availability === "online" && !r.busy).length ?? 0;
  return (
    <AdminFrame title="Dispatch" intro="Rider availability, workload and the fairness rules used to choose who gets each ride offer.">
      <section className="mt-6 space-y-3">
        <p className="text-sm">{riders.data?.length ?? 0} approved riders · {online} online and free</p>
        {riders.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : riders.isError ? <p className="text-sm text-destructive">{riders.error.message}</p> : (
          [...(riders.data ?? [])].sort((a, b) => b.fairness.score - a.fairness.score).map((r) => (
            <details key={r.user_id} className="surface-panel p-3 text-sm">
              <summary className="cursor-pointer">
                <b>{r.full_name}</b>{r.plate_number ? ` · ${r.plate_number}` : ""} · {r.busy ? "On a ride" : r.availability}{r.has_pending_offer ? " · offer pending" : ""} · score {r.fairness.score}
              </summary>
              <div className="mt-3"><Explain b={r.fairness} /></div>
            </details>
          ))
        )}
      </section>
      <div className="mt-8"><SettingsForm /></div>
    </AdminFrame>
  );
}
