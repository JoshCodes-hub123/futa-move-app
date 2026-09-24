import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinPlus, TriangleAlert } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminFrame } from "@/features/admin-console";
import { CATEGORY_LABELS, CATEGORY_ORDER, LOCATION_TYPES, listAllLocations, type FutaLocation, type LocationCategory } from "@/services/locations";
import { adminListSuggestions, approveSuggestion, findPossibleDuplicates, rejectSuggestion, suggestionImageUrl, type LocationSuggestion, type SuggestionStatus } from "@/services/location-suggestions";

const DEFAULT_TYPE: Record<LocationCategory, string> = { GATE: "gate", ACADEMIC: "academic_building", HOSTEL: "hostel" };
const select = "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

function Photo({ path }: { path: string | null }) {
  const q = useQuery({ queryKey: ["sugg-img", path], queryFn: () => suggestionImageUrl(path), enabled: !!path, staleTime: 60_000 });
  if (!path) return null;
  return q.data ? <a href={q.data} target="_blank" rel="noreferrer"><img src={q.data} alt="Suggested place" className="h-32 w-48 rounded-lg border border-border object-cover" /></a> : <div className="h-32 w-48 animate-pulse rounded-lg bg-muted" />;
}

function SuggestionRow({ s, locations }: { s: LocationSuggestion; locations: FutaLocation[] }) {
  const qc = useQueryClient();
  const dupes = useMemo(() => findPossibleDuplicates(s.name, locations), [s.name, locations]);
  const [mode, setMode] = useState<"create" | "update_existing" | "use_existing">(dupes.length ? "use_existing" : "create");
  const [locationId, setLocationId] = useState(dupes[0]?.id ?? "");
  const [name, setName] = useState(s.name);
  const [category, setCategory] = useState<LocationCategory>(s.category);
  const [type, setType] = useState(DEFAULT_TYPE[s.category]);
  const [description, setDescription] = useState(s.description ?? "");
  const [lat, setLat] = useState(s.latitude?.toString() ?? "");
  const [lng, setLng] = useState(s.longitude?.toString() ?? "");
  const [placeId, setPlaceId] = useState(s.google_place_id ?? "");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = s.status === "pending";

  async function approve() {
    setError(null);
    const la = lat.trim() ? Number(lat) : null; const lo = lng.trim() ? Number(lng) : null;
    if ((la === null) !== (lo === null) || (la !== null && !Number.isFinite(la)) || (lo !== null && !Number.isFinite(lo))) return setError("Enter both coordinates as numbers, or neither.");
    if (mode !== "create" && !locationId) return setError("Choose the existing location.");
    setBusy(true);
    try { await approveSuggestion(s.id, { mode, locationId: mode === "create" ? null : locationId, name, category, locationType: type, description, latitude: la, longitude: lo, googlePlaceId: placeId }); await Promise.all([qc.invalidateQueries({ queryKey: ["admin-suggestions"] }), qc.invalidateQueries({ queryKey: ["admin-locations"] })]); }
    catch (e) { setError(e instanceof Error ? e.message : "Approval failed"); } finally { setBusy(false); }
  }
  async function reject() {
    if (!reason.trim()) return setError("Add a reason for the rejection.");
    setBusy(true); setError(null);
    try { await rejectSuggestion(s.id, reason.trim()); await qc.invalidateQueries({ queryKey: ["admin-suggestions"] }); }
    catch (e) { setError(e instanceof Error ? e.message : "Rejection failed"); } finally { setBusy(false); }
  }

  return (
    <article className="py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-bold tracking-tight">{s.name}</p>
          <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[s.category]} · suggested by a {s.submitter_role} · {new Date(s.created_at).toLocaleString()}</p>
          {s.description && <p className="mt-2 text-sm">{s.description}</p>}
          <p className="mt-2 text-sm"><span className="text-muted-foreground">Why:</span> {s.reason}</p>
          {s.latitude != null && <p className="mt-1 text-xs text-muted-foreground">Suggested coordinates: {s.latitude}, {s.longitude}</p>}
          {s.google_place_id && <p className="mt-1 text-xs text-muted-foreground">Place ID: {s.google_place_id}</p>}
          {s.rejection_reason && <p className="mt-1 text-sm text-destructive">Rejected: {s.rejection_reason}</p>}
          {s.approved_location_id && <p className="mt-1 text-sm">Approved as: {locations.find((l) => l.id === s.approved_location_id)?.name ?? "location"}</p>}
        </div>
        <Photo path={s.image_path} />
      </div>

      {pending && (
        <div className="mt-5 rounded-card border border-border p-4">
          {dupes.length > 0 && (
            <p className="mb-4 flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0" />
              Possible existing match: {dupes.map((d) => `${d.name}${d.active ? "" : " (inactive)"}`).join(", ")}. Decide whether to use it, update it, or create a genuinely different place.</p>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            {([["use_existing", "Use existing location"], ["update_existing", "Update existing location"], ["create", "Create new location"]] as const).map(([m, label]) =>
              <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full border px-3 py-1.5 ${mode === m ? "border-foreground bg-muted font-medium" : "border-border text-muted-foreground"}`}>{label}</button>)}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {mode !== "create" && (
              <div className="sm:col-span-2"><Label className="text-xs">Existing location</Label>
                <select className={select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Choose…</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.active ? "" : " (inactive)"}</option>)}
                </select>
              </div>
            )}
            {mode !== "use_existing" && <>
              <div><Label className="text-xs">{mode === "create" ? "Name" : "New name (blank keeps current)"}</Label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label className="text-xs">Category</Label><select className={select} value={category} onChange={(e) => { const c = e.target.value as LocationCategory; setCategory(c); setType(DEFAULT_TYPE[c]); }}>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></div>
              <div><Label className="text-xs">Type</Label><select className={select} value={type} onChange={(e) => setType(e.target.value)}>{LOCATION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
              <div><Label className="text-xs">Google Place ID</Label><Input className="mt-1" value={placeId} onChange={(e) => setPlaceId(e.target.value)} /></div>
              <div><Label className="text-xs">Latitude</Label><Input className="mt-1" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></div>
              <div><Label className="text-xs">Longitude</Label><Input className="mt-1" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></div>
              <div className="sm:col-span-2"><Label className="text-xs">Description</Label><Input className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            </>}
          </div>
          {rejecting && <Textarea className="mt-4" placeholder="Reason for rejection (shown to the person who suggested it)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void approve()}>Approve</Button>
            {rejecting ? <Button variant="destructive" disabled={busy} onClick={() => void reject()}>Confirm reject</Button> : <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>}
          </div>
        </div>
      )}
    </article>
  );
}

const TABS: SuggestionStatus[] = ["pending", "approved", "rejected"];

function SuggestionsManager() {
  const sugg = useQuery({ queryKey: ["admin-suggestions"], queryFn: adminListSuggestions });
  const locs = useQuery({ queryKey: ["admin-locations"], queryFn: listAllLocations });
  const [tab, setTab] = useState<SuggestionStatus>("pending");
  if (sugg.isLoading || locs.isLoading) return <LoadingState />;
  const all = sugg.data ?? [];
  const rows = all.filter((s) => s.status === tab);
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full border px-3 py-1.5 text-sm capitalize ${tab === t ? "border-foreground bg-muted font-medium" : "border-border text-muted-foreground"}`}>{t} ({all.filter((s) => s.status === t).length})</button>)}
      </div>
      {rows.length ? <div className="mt-4 divide-y divide-border">{rows.map((s) => <SuggestionRow key={s.id} s={s} locations={locs.data ?? []} />)}</div>
        : <div className="mt-6"><EmptyState icon={MapPinPlus} title="Nothing here" description="Location suggestions with this status will appear here." /></div>}
    </>
  );
}

export function AdminLocationSuggestionsPage() {
  return (
    <AdminFrame title="Location suggestions" intro="Places suggested by students and riders. Approving adds or updates an entry in the official location list — nothing appears in the app until you approve it.">
      <SuggestionsManager />
    </AdminFrame>
  );
}
