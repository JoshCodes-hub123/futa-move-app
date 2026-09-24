import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ShieldCheck, X } from "lucide-react";
import { Brand } from "@/components/futamove/brand";
import { EmptyState, LoadingState } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { AdminNav } from "@/features/admin-console";
import { Textarea } from "@/components/ui/textarea";
import { amIAdmin, listPendingSubmissions, reviewSubmission, signedImageUrl, type VerificationSubmission } from "@/services/student-profile";

function SecureImage({ bucket, path, alt, className }: { bucket: "profile-photos" | "student-id-cards"; path: string; alt: string; className: string }) {
  const q = useQuery({ queryKey: ["signed", bucket, path], queryFn: () => signedImageUrl(bucket, path, 120), staleTime: 60_000 });
  if (q.isLoading) return <div className={`${className} animate-pulse bg-muted`} />;
  if (!q.data) return <div className={`${className} grid place-items-center bg-muted text-xs text-muted-foreground`}>Unavailable</div>;
  return <a href={q.data} target="_blank" rel="noreferrer"><img src={q.data} alt={alt} className={`${className} object-cover`} /></a>;
}

function SubmissionRow({ s }: { s: VerificationSubmission }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(approve: boolean) {
    if (!approve && !reason.trim()) { setError("Add a reason so the student knows what to fix."); return; }
    setBusy(true); setError(null);
    try { await reviewSubmission(s.id, approve, approve ? undefined : reason.trim()); await qc.invalidateQueries({ queryKey: ["admin-pending"] }); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  }
  return (
    <article className="grid gap-5 py-6 md:grid-cols-[auto_1fr_auto]">
      <SecureImage bucket="profile-photos" path={s.avatar_path} alt={`${s.full_name} profile photo`} className="size-20 rounded-full" />
      <div className="min-w-0">
        <p className="text-lg font-bold tracking-tight">{s.full_name}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Matric</dt><dd className="font-medium">{s.matric_number}</dd>
          <dt className="text-muted-foreground">Faculty</dt><dd className="font-medium">{s.faculty}</dd>
          <dt className="text-muted-foreground">Submitted</dt><dd>{new Date(s.created_at).toLocaleString()}</dd>
        </dl>
        <p className="section-label mt-4">FUTA ID card</p>
        <SecureImage bucket="student-id-cards" path={s.id_card_path} alt="FUTA student ID card" className="mt-2 h-44 w-full max-w-sm rounded-lg border border-border" />
        {rejecting && <Textarea className="mt-4 max-w-sm" placeholder="Reason for rejection (shown to the student)" value={reason} onChange={(e) => setReason(e.target.value)} />}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex gap-2 md:flex-col">
        <Button disabled={busy} onClick={() => void act(true)}><Check /> Approve</Button>
        {rejecting ? <Button variant="destructive" disabled={busy} onClick={() => void act(false)}><X /> Confirm reject</Button>
          : <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}><X /> Reject</Button>}
      </div>
    </article>
  );
}

export function AdminVerificationPage() {
  const admin = useQuery({ queryKey: ["am-admin"], queryFn: amIAdmin });
  const pending = useQuery({ queryKey: ["admin-pending"], queryFn: listPendingSubmissions, enabled: admin.data === true });
  return (
    <main className="min-h-screen bg-background px-5 py-8 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between"><Brand compact /><Link to="/student/home" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to app</Link></header>
        <AdminNav />
        <h1 className="display-title mt-10 text-3xl">Student verification</h1>
        <p className="mt-2 text-sm text-muted-foreground">Review pending submissions. Approving lets the student join shared ride matching.</p>
        <div className="mt-8 divider-list border-t border-border">
          {admin.isLoading ? <LoadingState /> : admin.data !== true ? <EmptyState title="Administrators only" description="Your account doesn't have access to verification review." icon={ShieldCheck} />
            : pending.isLoading ? <LoadingState /> : pending.error ? <p className="py-6 text-sm text-destructive">{(pending.error as Error).message}</p>
            : !pending.data?.length ? <EmptyState title="No pending submissions" description="New verification requests will appear here." icon={ShieldCheck} />
            : pending.data.map((s) => <SubmissionRow key={s.id} s={s} />)}
        </div>
      </div>
    </main>
  );
}
