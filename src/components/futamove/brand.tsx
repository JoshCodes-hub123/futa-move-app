import logo from "@/assets/futamove-logo.webp";
import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center", className)}>
      <img
        src={logo}
        alt="FUTAMOVE"
        className={cn(
          "shrink-0 rounded-md object-contain",
          compact ? "h-12 w-[9.75rem] sm:h-14 sm:w-[11rem]" : "h-24 w-full max-w-[18rem]",
        )}
      />
    </div>
  );
}