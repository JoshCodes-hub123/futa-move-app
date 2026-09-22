import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, CarFront, CircleUserRound, Home, Route, WalletCards, ClipboardList } from "lucide-react";
import { Brand } from "./brand";
import { cn } from "@/lib/utils";

type Role = "student" | "rider";
const nav = {
  student: [
    { label: "Home", to: "/student/home", icon: Home },
    { label: "Rides", to: "/student/rides", icon: CarFront },
    { label: "Activity", to: "/student/activity", icon: Activity },
    { label: "Profile", to: "/student/profile", icon: CircleUserRound },
  ],
  rider: [
    { label: "Home", to: "/rider/home", icon: Home },
    { label: "Requests", to: "/rider/requests", icon: ClipboardList },
    { label: "Trips", to: "/rider/trips", icon: Route },
    { label: "Wallet", to: "/rider/wallet", icon: WalletCards },
    { label: "Profile", to: "/rider/profile", icon: CircleUserRound },
  ],
} as const;

export function AppShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="min-h-screen bg-app-canvas">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-background px-5 py-7 lg:flex lg:flex-col">
        <Brand compact />
        <nav className="mt-10 space-y-1">
          {nav[role].map(({ label, to, icon: Icon }) => {
            const active = pathname === to;
            return <Link key={to} to={to} className={cn("flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="size-5" /><span>{label}</span></Link>;
          })}
        </nav>
        <p className="mt-auto text-xs leading-5 text-muted-foreground">Built for verified FUTA students.</p>
      </aside>
      <main className="mx-auto min-h-screen w-full max-w-app bg-background px-4 pb-28 pt-6 sm:px-6 lg:ml-64 lg:max-w-3xl lg:px-10 lg:pb-10 lg:pt-9">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-safe backdrop-blur lg:hidden">
        <div className={cn("mx-auto grid h-18 max-w-app items-center px-2", role === "rider" ? "grid-cols-5" : "grid-cols-4")}>
          {nav[role].map(({ label, to, icon: Icon }) => {
            const active = pathname === to;
            return <Link key={to} to={to} aria-label={label} className={cn("flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground")}><span className={cn("grid size-8 place-items-center rounded-full", active && "bg-primary")}><Icon className="size-5" /></span><span className="truncate">{label}</span></Link>;
          })}
        </div>
      </nav>
    </div>
  );
}