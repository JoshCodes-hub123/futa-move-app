import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { AdminFrame } from "@/features/admin-console";
import { adminAuditLog, adminOpsOverview, type OpsOverview } from "@/services/admin-ops";
import { EVENT_LABEL } from "@/services/dispatch";
import { fmtTime } from "@/services/trips";

type Card = { key: keyof OpsOverview; label: string; to: "/admin/rides" | "/admin/verification" | "/admin/riders" | "/admin/location-suggestions"; urgent?: boolean };
const SECTIONS: { title: string; cards: Card[] }[] = [
  { title: "Rides right now", cards: [
    { key: "needs_action", label: "Need admin action", to: "/admin/rides", urgent: true },
    { key: "active_rides", label: "Active rides", to: "/admin/rides" },
    { key: "waiting_for_rider", label: "Waiting for a rider", to: "/admin/rides" },
    { key: "in_progress", label: "In progress", to: "/admin/rides" },
  ] },
  { title: "Queues", cards: [
    { key: "pending_student_verifications", label: "Student verifications", to: "/admin/verification", urgent: true },
    { key: "pending_lecturer_verifications", label: "Lecturer verifications", to: "/admin/verification", urgent: true },
    { key: "pending_rider_applications", label: "Rider applications", to: "/admin/riders", urgent: true },
    { key: "pending_location_suggestions", label: "Location suggestions", to: "/admin/location-suggestions" },
  ] },
  { title: "Riders", cards: [
    { key: "approved_riders", label: "Approved riders", to: "/admin/riders" },
    { key: "online_riders", label: "Online now", to: "/admin/riders" },
    { key: "busy_riders", label: "On a ride", to: "/admin/riders" },
  ] },
  { title: "Totals", cards: [
    { key: "requests_today", label: "Ride requests today", to: "/admin/rides" },
    { key: "requests_total", label: "Ride requests (all time)", to: "/admin/rides" },
    { key: "completed_today", label: "Completed today", to: "/admin/rides" },
    { key: "completed_total", label: "Completed (all time)", to: "/admin/rides" },
    { key: "cancelled_total", label: "Cancelled / expired", to: "/admin/rides" },
    { key: "no_show_total", label: "No-shows", to: "/admin/rides" },
  ] },
];

function actionLabel(a: string) {
  if (a.startsWith("Dispatch: ")) { const k = a.slice(10); return EVENT_LABEL[k] ?? k.replace(/_/g, " ").toLowerCase(); }
  return a.replace(/_/g, " ");
}

function AuditTrail() {
  const q = useQuery({ queryKey: ["admin-audit"], queryFn: () => adminAuditLog(60), refetchInterval: 60000 });
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <div className="text-sm"><p className="text-destructive">{q.error.message}</p><Button size="sm" variant="secondary" className="mt-2" onClick={() => void q.refetch()}>Try again</Button></div>;
  if (!q.data?.length) return <EmptyState icon={History} title="No admin actions yet" description="Approvals, rejections and ride interventions will be listed here." />;
  return (
    <ol className="divide-y divide-border">
      {q.data.map((r, i) => (
        <li key={i} className="py-3 text-sm">
          <p className="font-medium">{actionLabel(r.action)}{r.target ? <span className="text-muted-foreground"> · {r.target}</span> : null}</p>
          <p className="break-words text-xs text-muted-foreground">{fmtTime(r.at)} · by {r.actor_email ?? "system"}{r.reason ? ` · “${r.reason}”` : ""}</p>
        </li>
      ))}
    </ol>
  );
}

export function AdminOverviewPage() {
  const q = useQuery({ queryKey: ["admin-ops-overview"], queryFn: adminOpsOverview, refetchInterval: 30000 });
  return (
    <AdminFrame title="Overview" intro="What needs attention right now. Counts come straight from live records and refresh every 30 seconds.">
      {q.isLoading ? <LoadingState /> : q.isError ? (
        <div className="text-sm"><p className="text-destructive">{q.error.message}</p><Button size="sm" variant="secondary" className="mt-2" onClick={() => void q.refetch()}>Try again</Button></div>
      ) : (
        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <p className="section-label">{s.title}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {s.cards.map((c) => {
                  const n = q.data?.[c.key] ?? 0;
                  const hot = c.urgent && n > 0;
                  return (
                    <Link key={c.key} to={c.to} className={`surface-panel block min-h-24 p-4 transition-colors hover:bg-muted ${hot ? "border-destructive/60" : ""}`}>
                      <p className={`text-3xl font-bold tabular-nums ${hot ? "text-destructive" : ""}`}>{n}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{c.label}</p>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
          <section>
            <p className="section-label">Recent admin actions</p>
            <div className="mt-3 surface-panel px-4"><AuditTrail /></div>
          </section>
        </div>
      )}
    </AdminFrame>
  );
}
