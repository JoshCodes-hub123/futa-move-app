import logo from "@/assets/futamove-logo-2026.jpg.asset.json";
import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <img
        src={logo.url}
        alt="FUTAMOVE"
        className={cn("shrink-0 rounded-md object-contain ring-1 ring-border/40", compact ? "size-11" : "size-16")}
      />
      <div className="min-w-0">
        <p className={cn("font-display font-bold uppercase leading-none text-foreground", compact ? "text-xl" : "text-3xl")}>
          FUTA<span className="text-brand">MOVE</span>
        </p>
        {!compact && <p className="mt-1.5 text-xs font-medium text-muted-foreground">Smarter rides. Brighter days.</p>}
      </div>
    </div>
  );
}