import logo from "@/assets/futamove-logo.png.asset.json";
import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <img
        src={logo.url}
        alt="FUTAMOVE"
        className={cn("shrink-0 object-contain", compact ? "size-9" : "size-14")}
      />
      <div className="min-w-0">
        <p className={cn("font-black leading-none text-foreground", compact ? "text-lg" : "text-2xl")}>
          FUTA<span className="text-brand">MOVE</span>
        </p>
        {!compact && <p className="mt-1 text-xs text-muted-foreground">Smarter rides. Brighter days.</p>}
      </div>
    </div>
  );
}