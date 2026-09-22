import { useState } from "react";
import { CalendarClock, ChevronRight, Clock3, CreditCard, FileCheck2, HelpCircle, History, LocateFixed, MapPin, Navigation, Route, Settings, ShieldCheck, UserRound } from "lucide-react";
import { AppShell } from "@/components/futamove/app-shell";
import { EmptyState, FeaturePlaceholder, RowLink, ScreenHeader, SectionHeading, StatusBadge, UserAvatar } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { recentRide, upcomingRide } from "@/services/mock-data";

export function StudentHomePage() {
  const [open, setOpen] = useState(false);
  return <AppShell role="student"><ScreenHeader eyebrow="Good morning" title="Hi, Fola" action={<UserAvatar />} /><section className="mt-8"><h2 className="text-3xl font-black leading-tight">Where are you going?</h2><p className="mt-2 text-sm text-muted-foreground">Find FUTA students heading in the same direction.</p><Card className="mt-5"><CardContent className="p-4"><div className="relative space-y-1"><div className="journey-line" /><LocationField icon={LocateFixed} label="Current location" placeholder="FUTA Main Gate" /><LocationField icon={MapPin} label="Destination" placeholder="Where to?" /></div><Button variant="soft" className="mt-3 w-full justify-start"><Clock3 /> Leaving now <ChevronRight className="ml-auto" /></Button><Button size="lg" className="mt-3 w-full" onClick={() => setOpen(true)}><Navigation /> Find my ride</Button></CardContent></Card></section><section className="mt-8 space-y-4"><SectionHeading title="Current ride" /><Card><EmptyState title="No ride in progress" description="When a ride starts, its live status will appear here." icon={Navigation} /></Card></section><section className="mt-8 space-y-4"><SectionHeading title="Upcoming ride" detail="Today" /><RideCard from={upcomingRide.from} to={upcomingRide.to} time={upcomingRide.time} /></section><section className="mt-8 space-y-4"><SectionHeading title="Recent activity" /><RideCard from={recentRide.from} to={recentRide.to} time={recentRide.time} complete /></section><Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="rounded-t-sheet"><SheetHeader><SheetTitle>Ride search is almost ready</SheetTitle><SheetDescription>Your trip details are set. Matching with compatible student rides arrives in the next phase.</SheetDescription></SheetHeader><Button className="mt-6 w-full" onClick={() => setOpen(false)}>Got it</Button></SheetContent></Sheet></AppShell>;
}

function LocationField({ icon: Icon, label, placeholder }: { icon: typeof MapPin; label: string; placeholder: string }) {
  return <label className="relative z-10 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted"><span className="grid size-9 place-items-center rounded-full bg-background text-muted-foreground"><Icon className="size-4" /></span><span className="min-w-0"><span className="block text-xs font-medium text-muted-foreground">{label}</span><Input aria-label={label} placeholder={placeholder} className="h-7 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0" /></span></label>;
}

function RideCard({ from, to, time, complete = false }: { from: string; to: string; time: string; complete?: boolean }) {
  return <Card><CardContent className="p-4"><div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><Route className="size-5" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{from} → {to}</p><p className="mt-1 text-xs text-muted-foreground">{time}</p></div></div><StatusBadge status={complete ? "Ready" : "Scheduled"} /></div></CardContent></Card>;
}

const studentPlaceholders = {
  rides: { title: "Your rides", description: "Requested, matched, and completed rides will be organised here.", icon: Navigation },
  activity: { title: "No recent activity", description: "Ride updates and verification activity will appear here.", icon: History },
} as const;

export function StudentPlaceholderPage({ type }: { type: keyof typeof studentPlaceholders }) {
  const item = studentPlaceholders[type];
  return <AppShell role="student"><ScreenHeader title={type === "rides" ? "Rides" : "Activity"} /><FeaturePlaceholder {...item} /></AppShell>;
}

export function StudentProfilePage() {
  return <AppShell role="student"><ScreenHeader title="Profile" /><Card className="mt-6"><CardContent className="flex items-center gap-4 p-5"><UserAvatar /><div className="min-w-0 flex-1"><p className="truncate font-semibold">Fola Adeyemi</p><p className="mt-1 text-xs text-muted-foreground">FUTA student</p></div><StatusBadge status="Verified" /></CardContent></Card><div className="mt-6 space-y-1"><RowLink icon={UserRound} title="Personal details" description="Name, faculty and matric number" /><RowLink icon={ShieldCheck} title="Verification" description="FUTA identity verified" /><RowLink icon={Settings} title="Preferences" /><RowLink icon={HelpCircle} title="Help and safety" /></div></AppShell>;
}

export function RiderHomePage() {
  return <AppShell role="rider"><ScreenHeader eyebrow="Rider mode" title="Ready to move?" action={<UserAvatar initials="RK" />} /><Card className="mt-7 bg-dark-surface text-dark-foreground"><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-sm font-medium">Availability</span><StatusBadge status="Ready" /></div><h2 className="mt-8 text-2xl font-bold">You’re currently offline</h2><p className="mt-2 text-sm leading-6 text-dark-muted">Go online when you’re ready to receive student ride requests.</p><Button className="mt-5 w-full">Go online</Button></CardContent></Card><section className="mt-8 space-y-4"><SectionHeading title="Today" /><Card><EmptyState title="No trips scheduled" description="Accepted requests for today will appear here." icon={CalendarClock} /></Card></section></AppShell>;
}

const riderPlaceholders = {
  requests: { title: "No ride requests", description: "Compatible student requests will appear here when you are online.", icon: FileCheck2 },
  trips: { title: "No trips yet", description: "Accepted and completed trips will be organised here.", icon: Route },
  wallet: { title: "Wallet preview", description: "Your future trip balance and payment activity will appear here.", icon: CreditCard },
} as const;

export function RiderPlaceholderPage({ type }: { type: keyof typeof riderPlaceholders }) {
  const item = riderPlaceholders[type];
  return <AppShell role="rider"><ScreenHeader title={type.charAt(0).toUpperCase() + type.slice(1)} /><FeaturePlaceholder {...item} /></AppShell>;
}

export function RiderProfilePage() {
  return <AppShell role="rider"><ScreenHeader title="Rider profile" /><Card className="mt-6"><CardContent className="flex items-center gap-4 p-5"><UserAvatar initials="RK" /><div className="min-w-0 flex-1"><p className="truncate font-semibold">Rider account</p><p className="mt-1 text-xs text-muted-foreground">Campus mobility partner</p></div><StatusBadge status="Pending" /></CardContent></Card><div className="mt-6 space-y-1"><RowLink icon={UserRound} title="Personal details" /><RowLink icon={ShieldCheck} title="Rider verification" description="Complete before accepting requests" /><RowLink icon={Settings} title="Preferences" /><RowLink icon={HelpCircle} title="Help and safety" /></div></AppShell>;
}