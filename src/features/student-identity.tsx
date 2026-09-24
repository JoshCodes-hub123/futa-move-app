import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";
import { getMyStudentProfile, signedImageUrl, VERIFICATION_LABEL } from "@/services/student-profile";
import { cn } from "@/lib/utils";

export function useStudentProfile() {
  const { user } = useAuth();
  const profile = useQuery({ queryKey: ["student-profile", user?.id], queryFn: getMyStudentProfile, enabled: !!user });
  const photo = useQuery({
    queryKey: ["student-photo", profile.data?.avatar_path],
    queryFn: () => signedImageUrl("profile-photos", profile.data?.avatar_path, 3600),
    enabled: !!profile.data?.avatar_path,
    staleTime: 50 * 60 * 1000,
  });
  const status = profile.data?.verification_status ?? "none";
  return { user, profile, photoUrl: photo.data ?? null, status } as const;
}

export function StudentPhoto({ url, initials, className }: { url: string | null; initials: string; className?: string }) {
  return (
    <Avatar className={cn("size-11 ring-1 ring-border", className)}>
      {url && <AvatarImage src={url} alt="Profile photo" className="object-cover" />}
      <AvatarFallback className="bg-dark-surface text-sm font-bold text-dark-foreground">{initials}</AvatarFallback>
    </Avatar>
  );
}

const tone = {
  none: { icon: ShieldQuestion, cls: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  pending: { icon: ShieldQuestion, cls: "bg-warning-soft text-warning", dot: "bg-warning" },
  verified: { icon: ShieldCheck, cls: "bg-success-soft text-success", dot: "bg-success" },
  rejected: { icon: ShieldAlert, cls: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
} as const;

export function VerificationBadge({ status }: { status: keyof typeof tone }) {
  const t = tone[status];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold", t.cls)}><span className={cn("size-1.5 rounded-full", t.dot)} />{VERIFICATION_LABEL[status]}</span>;
}

/** Shown on Home whenever the student is not verified. Never claims verification the server hasn't granted. */
export function VerificationBanner({ status }: { status: keyof typeof tone }) {
  if (status === "verified") return null;
  const t = tone[status];
  const Icon = t.icon;
  const detail = status === "pending" ? "Our team is reviewing your details. Shared ride matching unlocks once you're approved."
    : status === "rejected" ? "Please correct your details and resubmit to join shared rides."
    : "Submit your matric number, profile photo and FUTA ID card to join shared rides.";
  return (
    <Link to="/verification" className="mt-6 flex items-center gap-3 rounded-card border border-border px-4 py-3.5 transition-colors hover:bg-muted/50">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", t.cls)}><Icon className="size-[18px]" strokeWidth={1.75} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{VERIFICATION_LABEL[status]}</span><span className="block text-xs leading-5 text-muted-foreground">{detail}</span></span>
      {status !== "pending" && <ChevronRight className="size-4 text-muted-foreground" />}
    </Link>
  );
}
