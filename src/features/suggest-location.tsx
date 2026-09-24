import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, MapPinPlus } from "lucide-react";
import { AppShell } from "@/components/futamove/app-shell";
import { EmptyState, ScreenHeader, SectionHeading } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImagePicker } from "@/features/verification";
import { CATEGORY_LABELS, CATEGORY_ORDER, type LocationCategory } from "@/services/locations";
import { listMySuggestions, submitSuggestion } from "@/services/location-suggestions";

const STATUS_STYLE = { pending: "border-border text-muted-foreground", approved: "border-brand/40 bg-brand/10 text-foreground", rejected: "border-destructive/30 bg-destructive/5 text-destructive" } as const;

export function SuggestLocationPage({ role }: { role: "student" | "rider" }) {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ["my-suggestions"], queryFn: listMySuggestions });
  const [name, setName] = useState("");
  const [category, setCategory] = useState<LocationCategory>("HOSTEL");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (name.trim().length < 2) return setMsg({ ok: false, text: "Enter the name of the place." });
    if (reason.trim().length < 3) return setMsg({ ok: false, text: "Tell us why FUTAMOVE should add it." });
    const la = lat.trim() ? Number(lat) : null; const lo = lng.trim() ? Number(lng) : null;
    if ((la === null) !== (lo === null) || (la !== null && (!Number.isFinite(la) || Math.abs(la) > 90)) || (lo !== null && (!Number.isFinite(lo) || Math.abs(lo) > 180)))
      return setMsg({ ok: false, text: "Enter both latitude and longitude as numbers, or leave both empty." });
    if (photo && (!photo.type.startsWith("image/") || photo.size > 5 * 1024 * 1024)) return setMsg({ ok: false, text: "The photo must be an image under 5MB." });
    setBusy(true);
    try {
      await submitSuggestion({ name: name.trim(), category, description, latitude: la, longitude: lo, googlePlaceId: placeId, reason: reason.trim(), photo });
      setName(""); setDescription(""); setReason(""); setLat(""); setLng(""); setPlaceId(""); setPhoto(null);
      setMsg({ ok: true, text: "Thanks! FUTAMOVE will review your suggestion." });
      await qc.invalidateQueries({ queryKey: ["my-suggestions"] });
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't send your suggestion." }); }
    finally { setBusy(false); }
  }

  return (
    <AppShell role={role}>
      <ScreenHeader eyebrow="Community" title="Suggest a location" />
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Missing a pickup spot or destination? Suggest it and the FUTAMOVE team will review it before it appears in the app.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div><Label htmlFor="sg-name">Name of the place</Label><Input id="sg-name" className="mt-2" placeholder="e.g. New Female Hostel" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label>Category</Label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {CATEGORY_ORDER.map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={`h-11 rounded-lg border text-sm font-medium transition-colors ${category === c ? "border-foreground bg-muted" : "border-border text-muted-foreground hover:bg-muted/50"}`}>{CATEGORY_LABELS[c]}</button>)}
          </div>
        </div>
        <div><Label htmlFor="sg-desc">Description (optional)</Label><Input id="sg-desc" className="mt-2" placeholder="e.g. Main entrance of the hostel" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div><Label htmlFor="sg-reason">Why should FUTAMOVE add this?</Label><Textarea id="sg-reason" className="mt-2" placeholder="e.g. Students regularly use this as a pickup point." value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <details className="rounded-card border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">Location details (optional)</summary>
          <div className="mt-4 grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="sg-lat" className="text-xs">Latitude</Label><Input id="sg-lat" inputMode="decimal" className="mt-1" value={lat} onChange={(e) => setLat(e.target.value)} /></div>
              <div><Label htmlFor="sg-lng" className="text-xs">Longitude</Label><Input id="sg-lng" inputMode="decimal" className="mt-1" value={lng} onChange={(e) => setLng(e.target.value)} /></div>
            </div>
            <div><Label htmlFor="sg-place" className="text-xs">Google Place ID</Label><Input id="sg-place" className="mt-1" value={placeId} onChange={(e) => setPlaceId(e.target.value)} /></div>
            <ImagePicker id="sg-photo" label="Photo" hint="Optional, under 5MB" icon={Camera} file={photo} onChange={setPhoto} />
          </div>
        </details>
        {msg && <p role="alert" className={`rounded-card border p-3 text-sm ${msg.ok ? "border-brand/30 bg-brand/10" : "border-destructive/25 bg-destructive/5 text-destructive"}`}>{msg.text}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send suggestion"}</Button>
      </form>

      <section className="mt-10 space-y-3">
        <SectionHeading title="Your suggestions" />
        {mine.data?.length ? (
          <ul className="divider-list border-t border-border">
            {mine.data.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[s.category]} · {new Date(s.created_at).toLocaleDateString()}</p>
                  {s.status === "rejected" && s.rejection_reason && <p className="mt-1 text-xs text-destructive">{s.rejection_reason}</p>}
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[s.status]}`}>{s.status}</span>
              </li>
            ))}
          </ul>
        ) : !mine.isLoading && <div className="surface-panel"><EmptyState compact icon={MapPinPlus} title="No suggestions yet" description="Places you suggest will show here with their review status." /></div>}
      </section>
    </AppShell>
  );
}
