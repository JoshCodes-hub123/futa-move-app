import type { LucideIcon } from "lucide-react";
import { AlertCircle, ArrowRight, Inbox, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function ScreenHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{eyebrow}</p>}
        <h1 className="truncate text-2xl font-bold text-foreground">{title}</h1>
      </div>
      {action}
    </header>
  );
}

export function UserAvatar({ initials = "FA" }: { initials?: string }) {
  return <Avatar className="size-11 border border-border"><AvatarFallback className="bg-dark-surface text-sm font-bold text-dark-foreground">{initials}</AvatarFallback></Avatar>;
}

export function StatusBadge({ status }: { status: "Verified" | "Pending" | "Ready" | "Scheduled" }) {
  const style = status === "Verified" || status === "Ready" ? "success" : status === "Pending" ? "warning" : "outline";
  return <Badge variant={style}>{status}</Badge>;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><Icon className="size-5" /></div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState() {
  return (
    <Card><CardContent className="flex items-start gap-3 p-4"><AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" /><div><p className="text-sm font-semibold">Couldn’t load this yet</p><p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p></div></CardContent></Card>
  );
}

export function LoadingState() {
  return <div className="space-y-3" aria-label="Loading"><Skeleton className="h-28 w-full rounded-card" /><Skeleton className="h-20 w-full rounded-card" /><Skeleton className="h-20 w-full rounded-card" /></div>;
}

export function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><h2 className="truncate text-base font-semibold">{title}</h2>{detail && <span className="text-xs text-muted-foreground">{detail}</span>}</div>;
}

export function TrustNote({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-brand-strong" />{children}</div>;
}

export function RowLink({ icon: Icon, title, description, onClick }: { icon: LucideIcon; title: string; description?: string; onClick?: () => void }) {
  return <Button variant="ghost" onClick={onClick} className="h-auto w-full justify-start rounded-card px-3 py-3 text-left"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{title}</span>{description && <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{description}</span>}</span><ArrowRight className="size-4 text-muted-foreground" /></Button>;
}

export function FeaturePlaceholder({ title, description, icon }: { title: string; description: string; icon?: LucideIcon }) {
  return <Card className={cn("mt-6 overflow-hidden")}><EmptyState title={title} description={description} icon={icon} /></Card>;
}