import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, CalendarClock, MapPinPlus, Moon, Phone, ShieldCheck, Sun } from "lucide-react";
import { AppShell } from "@/components/futamove/app-shell";
import { EmptyState, LoadingState, RowLink, ScreenHeader, SectionHeading } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { signOutEverywhere } from "@/features/auth-pages";
import { getMyRiderApplication, riderDocumentUrl, RIDER_STATUS_LABEL } from "@/services/riders";

function useRider() {
  const app = useQuery({ queryKey: ["my-rider-application"], queryFn: getMyRiderApplication });
  const photo = useQuery({ queryKey: ["rider-doc", app.data?.avatar_path], queryFn: () => riderDocumentUrl(app.data?.avatar_path, 600), enabled: !!app.data?.avatar_path });
  return { app, photo: photo.data ?? null };
}

function Identity({ name, photo, meta, status }: { name: string; photo: string | null; meta: string; status: string }) {
  return (
    <div className="mt-8 flex items-center gap-4">
      {photo ? <img src={photo} alt="" className="size-16 rounded-full object-cover" /> : <span className="grid size-16 place-items-center rounded-full bg-muted font-bold">{name.slice(0, 2).toUpperCase()}</span>}
      <div className="min-w-0">
        <p className="truncate text-lg font-bold tracking-tight">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold"><ShieldCheck className="size-3.5" />{status}</span>
      </div>
    </div>
  );
}

export function RiderHomePage() {
  const { app, photo } = useRider();
  const a = app.data;
  return (
    <AppShell role="rider">
      <ScreenHeader eyebrow="Rider dashboard" title={a ? `Hi, ${a.full_name.split(" ")[0]}` : "Rider dashboard"} />
      {app.isLoading ? <LoadingState /> : a ? <>
        <Identity name={a.full_name} photo={photo} meta={`${a.vehicle_description}${a.plate_number ? ` · ${a.plate_number}` : ""}`} status={RIDER_STATUS_LABEL[a.status]} />
        <section className="mt-8 surface-panel p-5 text-sm leading-6">
          <p className="section-label">Rider status</p>
          <p className="mt-2">Your rider account is approved{a.reviewed_at ? ` since ${new Date(a.reviewed_at).toLocaleDateString()}` : ""}. Ride requests and trips will be added in a later update.</p>
        </section>
      </> : <p className="mt-6 text-sm text-muted-foreground">No rider details found.</p>}
      <section className="mt-10 space-y-4">
        <SectionHeading title="Trips" />
        <div className="surface-panel"><EmptyState compact title="No trips yet" description="Trips will appear here once ride assignment is available." icon={CalendarClock} /></div>
        <Button asChild variant="secondary" className="w-full"><Link to="/rider/suggest-location"><MapPinPlus /> Suggest a pickup location</Link></Button>
      </section>
    </AppShell>
  );
}

export function RiderProfilePage() {
  const { app, photo } = useRider();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const a = app.data;
  return (
    <AppShell role="rider">
      <ScreenHeader title="Rider profile" />
      {a && <Identity name={a.full_name} photo={photo} meta="FUTAMOVE keke rider" status={RIDER_STATUS_LABEL[a.status]} />}
      {a && <div className="mt-8 divider-list border-t border-border">
        <RowLink icon={Phone} title="Phone" description={a.phone} />
        <RowLink icon={Bike} title="Keke" description={`${a.vehicle_description}${a.plate_number ? ` · ${a.plate_number}` : ""}`} />
        <RowLink icon={ShieldCheck} title="Identification" description={[a.id_type, a.id_number].filter(Boolean).join(" · ") || "Not provided"} />
        <button type="button" className="w-full text-left" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><RowLink icon={theme === "dark" ? Sun : Moon} title="Appearance" description={theme === "dark" ? "Dark mode" : "Light mode"} /></button>
      </div>}
      <Button variant="secondary" className="mt-8 w-full" onClick={() => void signOutEverywhere(qc, navigate)}>Sign out</Button>
    </AppShell>
  );
}
