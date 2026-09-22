import { useState } from "react";
import {
  CalendarClock,
  ChevronRight,
  Clock3,
  CreditCard,
  FileCheck2,
  HelpCircle,
  History,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/futamove/app-shell";
import {
  EmptyState,
  FeaturePlaceholder,
  RowLink,
  ScreenHeader,
  SectionHeading,
  StatusBadge,
  UserAvatar,
} from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/futamove/bottom-sheet";
import { recentRide, upcomingRide } from "@/services/mock-data";

export function StudentHomePage() {
  const [open, setOpen] = useState(false);

  return (
    <AppShell role="student">
      <ScreenHeader eyebrow="Good morning" title="Hi, Fola" action={<UserAvatar />} />

      <section className="mt-10">
        <h2 className="display-title text-[2.125rem] sm:text-[2.5rem]">Where are you going?</h2>
        <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          Find FUTA students heading in the same direction.
        </p>

        <div className="surface-panel mt-7 p-2">
          <div className="relative">
            <div className="journey-line" />
            <LocationField icon={LocateFixed} label="Current location" placeholder="FUTA Main Gate" />
            <div className="ml-14 h-px bg-border" />
            <LocationField icon={MapPin} label="Destination" placeholder="Where to?" />
          </div>
        </div>

        <button
          type="button"
          className="mt-3 flex w-full items-center gap-3 rounded-card px-3 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
            <Clock3 className="size-[18px]" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">Departure time</span>
            <span className="block text-sm font-semibold">Leaving now</span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>

        <Button size="lg" className="mt-6 w-full" onClick={() => setOpen(true)}>
          <Navigation /> Find my ride
        </Button>
      </section>

      <section className="mt-12 space-y-4">
        <SectionHeading title="Current ride" />
        <div className="surface-panel">
          <EmptyState
            compact
            title="No ride in progress"
            description="When a ride starts, its live status will appear here."
            icon={Navigation}
          />
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading title="Upcoming ride" detail="Today" />
        <div className="mt-2 divider-list">
          <RideRow from={upcomingRide.from} to={upcomingRide.to} time={upcomingRide.time} />
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading title="Recent activity" />
        <div className="mt-2 divider-list">
          <RideRow from={recentRide.from} to={recentRide.to} time={recentRide.time} complete />
        </div>
      </section>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Ride search is almost ready"
        description="Your trip details are set. Matching with compatible student rides arrives in the next phase."
      >
        <Button className="mt-6 w-full" onClick={() => setOpen(false)}>
          Got it
        </Button>
      </BottomSheet>
    </AppShell>
  );
}

function LocationField({ icon: Icon, label, placeholder }: { icon: typeof MapPin; label: string; placeholder: string }) {
  return (
    <label className="relative z-10 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[0.875rem] px-3 py-3 transition-colors hover:bg-background/70">
      <span className="grid size-9 place-items-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <Input
          aria-label={label}
          placeholder={placeholder}
          className="h-7 border-0 bg-transparent p-0 text-[0.9375rem] font-medium shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-0"
        />
      </span>
    </label>
  );
}

function RideRow({ from, to, time, complete = false }: { from: string; to: string; time: string; complete?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
          <Route className="size-[18px]" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {from} <span className="text-muted-foreground">→</span> {to}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{time}</p>
        </div>
      </div>
      <StatusBadge status={complete ? "Ready" : "Scheduled"} />
    </div>
  );
}

const studentPlaceholders = {
  rides: { title: "Your rides", description: "Requested, matched, and completed rides will be organised here.", icon: Navigation },
  activity: { title: "No recent activity", description: "Ride updates and verification activity will appear here.", icon: History },
} as const;

export function StudentPlaceholderPage({ type }: { type: keyof typeof studentPlaceholders }) {
  const item = studentPlaceholders[type];
  return (
    <AppShell role="student">
      <ScreenHeader title={type === "rides" ? "Rides" : "Activity"} />
      <FeaturePlaceholder {...item} />
    </AppShell>
  );
}

function ProfileIdentity({ initials, name, meta, status }: { initials: string; name: string; meta: string; status: "Verified" | "Pending" }) {
  return (
    <div className="mt-8 flex items-center gap-4">
      <UserAvatar initials={initials} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-bold tracking-tight">{name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

export function StudentProfilePage() {
  return (
    <AppShell role="student">
      <ScreenHeader title="Profile" />
      <ProfileIdentity initials="FA" name="Fola Adeyemi" meta="FUTA student" status="Verified" />
      <div className="mt-8 divider-list border-t border-border">
        <RowLink icon={UserRound} title="Personal details" description="Name, faculty and matric number" />
        <RowLink icon={ShieldCheck} title="Verification" description="FUTA identity verified" />
        <RowLink icon={Settings} title="Preferences" />
        <RowLink icon={HelpCircle} title="Help and safety" />
      </div>
    </AppShell>
  );
}

export function RiderHomePage() {
  const [online, setOnline] = useState(false);
  return (
    <AppShell role="rider">
      <ScreenHeader eyebrow="Rider mode" title="Ready to move?" action={<UserAvatar initials="RK" />} />

      <section className="mt-8 rounded-card bg-dark-surface p-6 text-dark-foreground">
        <div className="flex items-center justify-between">
          <span className="section-label text-dark-muted">Availability</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-dark-border px-2.5 py-1 text-[0.6875rem] font-semibold">
            <span className={online ? "size-1.5 rounded-full bg-brand" : "size-1.5 rounded-full bg-dark-muted"} />
            {online ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
        <h2 className="mt-7 text-2xl font-bold tracking-tight">
          {online ? "You’re online" : "You’re currently offline"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-dark-muted">
          {online
            ? "You can receive student ride requests while you stay online."
            : "Go online when you’re ready to receive student ride requests."}
        </p>
        <Button
          variant={online ? "dark-outline" : "default"}
          size="lg"
          className="mt-6 w-full"
          onClick={() => setOnline((v) => !v)}
        >
          {online ? "Go offline" : "Go online"}
        </Button>
      </section>

      <section className="mt-10 space-y-4">
        <SectionHeading title="Today" />
        <div className="surface-panel">
          <EmptyState compact title="No trips scheduled" description="Accepted requests for today will appear here." icon={CalendarClock} />
        </div>
      </section>
    </AppShell>
  );
}

const riderPlaceholders = {
  requests: { title: "No ride requests", description: "Compatible student requests will appear here when you are online.", icon: FileCheck2 },
  trips: { title: "No trips yet", description: "Accepted and completed trips will be organised here.", icon: Route },
  wallet: { title: "Wallet preview", description: "Your future trip balance and payment activity will appear here.", icon: CreditCard },
} as const;

export function RiderPlaceholderPage({ type }: { type: keyof typeof riderPlaceholders }) {
  const item = riderPlaceholders[type];
  return (
    <AppShell role="rider">
      <ScreenHeader title={type.charAt(0).toUpperCase() + type.slice(1)} />
      <FeaturePlaceholder {...item} />
    </AppShell>
  );
}

export function RiderProfilePage() {
  return (
    <AppShell role="rider">
      <ScreenHeader title="Rider profile" />
      <ProfileIdentity initials="RK" name="Rider account" meta="Campus mobility partner" status="Pending" />
      <div className="mt-8 divider-list border-t border-border">
        <RowLink icon={UserRound} title="Personal details" />
        <RowLink icon={ShieldCheck} title="Rider verification" description="Complete before accepting requests" />
        <RowLink icon={Settings} title="Preferences" />
        <RowLink icon={HelpCircle} title="Help and safety" />
      </div>
    </AppShell>
  );
}
