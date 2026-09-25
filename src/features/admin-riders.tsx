import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AdminFrame } from "@/features/admin-console";
import { adminRiderPool, type RiderPoolRow } from "@/services/admin-ops";
import { adminListRiderApplications, reviewRiderApplication, riderDocumentUrl, RIDER_STATUS_LABEL, type AdminRiderApplication, type RiderApplicationStatus } from "@/services/riders";

function Doc({ path, alt, className }: { path: string | null; alt: string; className: string }) {
  const q = useQuery({ queryKey: ["rider-doc", path], queryFn: () => riderDocumentUrl(path, 120), enabled: !!path, staleTime: 60_000 });
  if (!path) return <div className={`${className} grid place-items-center bg-muted text-xs text-muted-foreground`}>Not provided</div>;
  if (!q.data) return <div className={`${className} animate-pulse bg-muted`} />;
  return <a href={q.data} target="_blank" rel="noreferrer"><img src={q.data} alt={alt} className={`${className} object-cover`} /></a>;
}

function RiderRow({ a, pool }: { a: AdminRiderApplication; pool?: RiderPoolRow | undefined }) {
  const qc = useQueryClient();
  const [reasonFor, setReasonFor] = useState<"reject" | "suspend" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "approve" | "reject" | "suspend" | "restore") {
    if (action === "reject" && !reason.trim()) return setError("Add a reason so the applicant knows why.");
    setBusy(true); setError(null);
    try { await reviewRiderApplication(a.id, action, reason.trim()); setReasonFor(null); setReason(""); await qc.invalidateQueries({ queryKey: ["admin-riders"] }); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  }
  return (
    <article className="grid gap-5 py-6 md:grid-cols-[auto_1fr_auto]">
      <Doc path={a.avatar_path} alt={`${a.full_name} photo`} className="size-20 rounded-full" />
      <div className="min-w-0">
        <p className="text-lg font-bold tracking-tight">{a.full_name}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt><dd className="break-all">{a.email ?? "—"}</dd>
          <dt className="text-muted-foreground">Phone</dt><dd>{a.phone}</dd>
          <dt className="text-muted-foreground">ID</dt><dd>{[a.id_type, a.id_number].filter(Boolean).join(" · ") || "Not provided"}</dd>
          <dt className="text-muted-foreground">Keke</dt><dd>{a.vehicle_description}</dd>
          <dt className="text-muted-foreground">Plate</dt><dd>{a.plate_number || "Not provided"}</dd>
          <dt className="text-muted-foreground">Applied</dt><dd>{new Date(a.created_at).toLocaleString()}</dd>
          <dt className="text-muted-foreground">Status</dt><dd className="font-semibold">{RIDER_STATUS_LABEL[a.status]}</dd>
          {a.status === "approved" && pool && <>
            <dt className="text-muted-foreground">Right now</dt><dd className="font-semibold capitalize">{pool.availability}{pool.location_updated_at ? <span className="font-normal normal-case text-muted-foreground"> · location shared {new Date(pool.location_updated_at).toLocaleTimeString()}</span> : null}</dd>
            {pool.current_trip_route && <><dt className="text-muted-foreground">Current ride</dt><dd className="break-words">{pool.current_trip_route} ({pool.current_trip_status?.replace("_", " ")})</dd></>}
            <dt className="text-muted-foreground">Rides</dt><dd>{pool.completed_rides} completed · {pool.rating_count ? `★ ${pool.rating_avg} from ${pool.rating_count} rating${pool.rating_count === 1 ? "" : "s"}` : "No ratings yet"}</dd>
          </>}
          {a.rejection_reason && <><dt className="text-muted-foreground">Reason</dt><dd>{a.rejection_reason}</dd></>}
        </dl>
        <div className="mt-4 flex flex-wrap gap-3">
          <div><p className="section-label mb-1">ID document</p><Doc path={a.id_document_path} alt="ID document" className="h-28 w-44 rounded-lg border border-border" /></div>
          <div><p className="section-label mb-1">Keke</p><Doc path={a.vehicle_photo_path} alt="Keke photo" className="h-28 w-44 rounded-lg border border-border" /></div>
        </div>
        {reasonFor && <Textarea className="mt-4 max-w-sm" placeholder={reasonFor === "reject" ? "Reason for rejection (shown to the applicant)" : "Reason for suspension (optional, shown to the rider)"} value={reason} onChange={(e) => setReason(e.target.value)} />}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2 md:flex-col">
        {a.status === "pending" && <>
          <Button disabled={busy} onClick={() => void act("approve")}>Approve</Button>
          {reasonFor === "reject" ? <Button variant="destructive" disabled={busy} onClick={() => void act("reject")}>Confirm reject</Button> : <Button variant="secondary" disabled={busy} onClick={() => setReasonFor("reject")}>Reject</Button>}
        </>}
        {a.status === "approved" && (reasonFor === "suspend" ? <Button variant="destructive" disabled={busy} onClick={() => void act("suspend")}>Confirm suspend</Button> : <Button variant="secondary" disabled={busy} onClick={() => setReasonFor("suspend")}>Suspend</Button>)}
        {a.status === "suspended" && <Button disabled={busy} onClick={() => void act("restore")}>Restore</Button>}
      </div>
    </article>
  );
}

const TABS: RiderApplicationStatus[] = ["pending", "approved", "rejected", "suspended"];

function RidersManager() {
  const q = useQuery({ queryKey: ["admin-riders"], queryFn: adminListRiderApplications });
  const pool = useQuery({ queryKey: ["admin-rider-pool"], queryFn: adminRiderPool, refetchInterval: 30000 });
  const [tab, setTab] = useState<RiderApplicationStatus>("pending");
  const [avail, setAvail] = useState<"all" | "online" | "offline" | "busy">("all");
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <div className="text-sm"><p className="text-destructive">{(q.error as Error).message}</p><Button size="sm" variant="secondary" className="mt-2" onClick={() => void q.refetch()}>Try again</Button></div>;
  const approved = (q.data ?? []).filter((a) => a.status === "approved");
  const countAvail = (s: string) => approved.filter((a) => (pool.data?.[a.user_id]?.availability ?? "offline") === s).length;
  const rows = (q.data ?? []).filter((a) => a.status === tab && (tab !== "approved" || avail === "all" || (pool.data?.[a.user_id]?.availability ?? "offline") === avail));
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full border px-3 py-1.5 text-sm ${tab === t ? "border-foreground bg-muted font-medium" : "border-border text-muted-foreground"}`}>{RIDER_STATUS_LABEL[t]} ({(q.data ?? []).filter((a) => a.status === t).length})</button>)}
      </div>
      {tab === "approved" && (
        <div className="mt-3 flex flex-wrap gap-1" aria-label="Filter by availability">
          {(["all", "online", "busy", "offline"] as const).map((s) => <button key={s} type="button" onClick={() => setAvail(s)} className={`min-h-9 rounded-full px-3 py-1.5 text-sm capitalize ${avail === s ? "bg-muted font-medium" : "text-muted-foreground"}`}>{s === "all" ? `All (${approved.length})` : `${s} (${countAvail(s)})`}</button>)}
          {pool.isError && <p className="w-full text-xs text-destructive">Live availability couldn't load. {pool.error.message}</p>}
        </div>
      )}
      {rows.length ? <div className="mt-4 divide-y divide-border">{rows.map((a) => <RiderRow key={a.id} a={a} pool={pool.data?.[a.user_id]} />)}</div>
        : <div className="mt-6"><EmptyState icon={Bike} title="Nothing here" description="Rider applications with this status will appear here." /></div>}
    </>
  );
}

export function AdminRidersPage() {
  return (
    <AdminFrame title="Riders" intro="Review keke rider applications. Approving grants rider access; suspending removes it immediately. Records are never deleted.">
      <RidersManager />
    </AdminFrame>
  );
}
