import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, History, Navigation, ShieldCheck, Users, XCircle } from "lucide-react";
import { AppShell } from "@/components/futamove/app-shell";
import { EmptyState, ScreenHeader } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fmtTime, STUDENT_TRIP_LABEL, type TripStatus } from "@/services/trips";

type Tone = "ride" | "group" | "done" | "bad" | "verify";
interface ActivityItem { id: string; at: string; title: string; detail: string; tone: Tone; href?: string | undefined }

const TRIP_DETAIL: Partial<Record<TripStatus, (d: string) => string>> = {
  confirmed: (d) => `Your ride to ${d} was confirmed. Finding a rider.`,
  assigned: (d) => `A rider was assigned to your ride to ${d}.`,
  accepted: (d) => `Your rider accepted the ride to ${d}.`,
  arriving: (d) => `Your rider is on the way to the meeting point for ${d}.`,
  picked_up: (d) => `You were picked up for your ride to ${d}.`,
  in_progress: (d) => `Your ride to ${d} is in progress.`,
  completed: (d) => `Your ride to ${d} was completed.`,
  cancelled_by_student: (d) => `Your ride to ${d} was cancelled.`,
  cancelled_by_rider: (d) => `The rider cancelled your ride to ${d}.`,
  cancelled_by_admin: (d) => `FUTAMOVE cancelled your ride to ${d}.`,
  expired: (d) => `Your ride to ${d} expired.`,
  no_show: (d) => `Your ride to ${d} was marked as a no-show.`,
};
const toneFor = (s: string): Tone => (s === "completed" ? "done" : s.startsWith("cancelled") || s === "expired" || s === "no_show" ? "bad" : "ride");

/** Built only from authoritative, RLS-protected records. Errors are thrown, never swallowed. */
async function loadActivity(uid: string): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];
  const [reqs, members, subs] = await Promise.all([
    supabase.from("ride_requests").select("id,destination_text,created_at,status,group_id,ride_type").eq("student_id", uid),
    supabase.from("ride_group_members").select("group_id,request_id,joined_at,ride_confirmed_at").eq("student_id", uid),
    supabase.from("verification_submissions").select("id,created_at,status,reviewed_at,rejection_reason").eq("student_id", uid),
  ]);
  for (const r of [reqs, members, subs]) if (r.error) throw new Error(r.error.message);

  const destByReq = new Map<string, string>();
  for (const r of reqs.data ?? []) {
    destByReq.set(r.id, r.destination_text);
    items.push({ id: `req-${r.id}`, at: r.created_at, title: "Ride request created", detail: `You requested a ${r.ride_type === "private" ? "private keke" : "shared ride"} to ${r.destination_text}.`, tone: "ride", href: r.id });
  }
  for (const m of members.data ?? []) {
    const d = destByReq.get(m.request_id) ?? "your destination";
    items.push({ id: `grp-${m.group_id}`, at: m.joined_at, title: "Matched into a group", detail: `You joined a ride group heading to ${d}.`, tone: "group", href: m.request_id });
    if (m.ride_confirmed_at) items.push({ id: `conf-${m.group_id}`, at: m.ride_confirmed_at, title: "You confirmed the ride", detail: `You confirmed the group ride to ${d}.`, tone: "group", href: m.request_id });
  }

  const groupIds = (members.data ?? []).map((m) => m.group_id);
  if (groupIds.length) {
    const trips = await supabase.from("trips").select("id,group_id,destination_text").in("group_id", groupIds);
    if (trips.error) throw new Error(trips.error.message);
    const tripById = new Map((trips.data ?? []).map((t) => [t.id, t]));
    const reqByGroup = new Map((members.data ?? []).map((m) => [m.group_id, m.request_id]));
    if (tripById.size) {
      const hist = await supabase.from("trip_status_history").select("id,trip_id,to_status,created_at").in("trip_id", [...tripById.keys()]);
      if (hist.error) throw new Error(hist.error.message);
      for (const h of hist.data ?? []) {
        const t = tripById.get(h.trip_id)!; const s = h.to_status as TripStatus;
        items.push({ id: `h-${h.id}`, at: h.created_at, title: STUDENT_TRIP_LABEL[s] ?? s, detail: TRIP_DETAIL[s]?.(t.destination_text) ?? `Ride to ${t.destination_text} updated.`, tone: toneFor(s), href: reqByGroup.get(t.group_id) });
      }
    }
  }

  for (const s of subs.data ?? []) {
    items.push({ id: `vs-${s.id}`, at: s.created_at, title: "Verification submitted", detail: "Your FUTA verification details were sent for review.", tone: "verify" });
    if (s.reviewed_at && s.status === "verified") items.push({ id: `va-${s.id}`, at: s.reviewed_at, title: "Verification approved", detail: "You can now join shared rides.", tone: "done" });
    if (s.reviewed_at && s.status === "rejected") items.push({ id: `vr-${s.id}`, at: s.reviewed_at, title: "Verification needs resubmission", detail: s.rejection_reason || "Please correct your details and resubmit.", tone: "bad" });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

const ICON = { ride: Navigation, group: Users, done: CheckCircle2, bad: XCircle, verify: ShieldCheck } as const;
const CLS = { ride: "bg-muted text-foreground", group: "bg-muted text-foreground", done: "bg-success-soft text-success", bad: "bg-destructive/10 text-destructive", verify: "bg-warning-soft text-warning" } as const;

export function StudentActivityPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["student-activity", user?.id], queryFn: () => loadActivity(user!.id), enabled: !!user, refetchOnWindowFocus: true, refetchInterval: 30000 });
  return (
    <AppShell role="student">
      <ScreenHeader title="Activity" />
      {q.isPending ? <p className="mt-8 text-sm text-muted-foreground">Loading activity…</p>
        : q.isError ? (
          <div className="surface-panel mt-8 p-5 text-sm">
            <p className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="size-4" /> Couldn't load your activity</p>
            <p className="mt-1 text-muted-foreground">{(q.error as Error).message}</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => void q.refetch()}>Try again</Button>
          </div>
        ) : !q.data.length ? (
          <div className="surface-panel mt-8"><EmptyState title="No recent activity" description="Ride updates and verification activity will appear here." icon={History} /></div>
        ) : (
          <ul className="mt-8 divide-y divide-border border-y border-border">
            {q.data.map((it) => { const Icon = ICON[it.tone]; const body = (
              <div className="flex gap-3.5 py-4">
                <span className={`grid size-9 shrink-0 place-items-center rounded-md ${CLS[it.tone]}`}><Icon className="size-[18px]" strokeWidth={1.75} /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{it.title}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{it.detail}</p><p className="mt-1 text-[0.6875rem] text-muted-foreground">{fmtTime(it.at)}</p></div>
              </div>);
              return <li key={it.id}>{it.href ? <Link to="/student/rides/$id" params={{ id: it.href }} className="block transition-colors hover:bg-muted/40">{body}</Link> : body}</li>; })}
          </ul>
        )}
    </AppShell>
  );
}
