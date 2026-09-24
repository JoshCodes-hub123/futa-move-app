import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, IdCard, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/futamove/brand";
import { FieldError, TrustNote } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { getMyStudentProfile, submitVerification, validateImage, VERIFICATION_LABEL } from "@/services/student-profile";

type Errors = Partial<Record<"fullName" | "matric" | "faculty" | "avatar" | "idCard" | "form", string>>;

export function ImagePicker({ id, label, hint, icon: Icon, file, onChange, error, round }: { id: string; label: string; hint: string; icon: typeof Camera; file: File | null; onChange: (f: File | null) => void; error?: string | undefined; round?: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div>
      <Label htmlFor={id} className="text-[0.8125rem] font-medium">{label}</Label>
      <label htmlFor={id} className={`mt-2 flex cursor-pointer items-center gap-4 rounded-card border border-dashed p-3 transition-colors hover:bg-muted/50 ${error ? "border-destructive" : "border-border"}`}>
        <span className={`grid shrink-0 place-items-center overflow-hidden bg-muted text-muted-foreground ${round ? "size-16 rounded-full" : "h-16 w-24 rounded-lg"}`}>
          {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <Icon className="size-5" strokeWidth={1.75} />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{file ? "Change image" : "Choose image"}</span>
          <span className="block truncate text-xs text-muted-foreground">{file ? file.name : hint}</span>
        </span>
      </label>
      <input id={id} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-invalid={!!error} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

export function VerificationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const profile = useQuery({ queryKey: ["student-profile", user?.id], queryFn: getMyStudentProfile, enabled: !!user });
  const [fullName, setFullName] = useState("");
  const [matric, setMatric] = useState("");
  const [faculty, setFaculty] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [idCard, setIdCard] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = profile.data;
    const meta = user?.user_metadata?.["full_name"];
    setFullName((v) => v || p?.full_name || (typeof meta === "string" ? meta : ""));
    if (p) { setMatric((v) => v || p.matric_number || ""); setFaculty((v) => v || p.faculty || ""); }
  }, [profile.data, user]);

  const status = profile.data?.verification_status;
  const locked = status === "verified" || (status === "pending" && !!profile.data?.current_submission_id);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Errors = {};
    if (!fullName.trim()) next.fullName = "Enter your full name.";
    if (!matric.trim()) next.matric = "Enter your matric number.";
    if (!faculty.trim()) next.faculty = "Enter your faculty.";
    const a = validateImage(avatar, "avatar"); if (a) next.avatar = a;
    const c = validateImage(idCard, "idCard"); if (c) next.idCard = c;
    setErrors(next);
    if (Object.keys(next).length || !avatar || !idCard) return;
    setLoading(true);
    try {
      await submitVerification({ fullName, matricNumber: matric, faculty, avatar, idCard });
      await qc.invalidateQueries({ queryKey: ["student-profile"] });
      await navigate({ to: "/student/home" });
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : "We couldn't submit your details. Check your connection and try again." });
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-background px-5 pb-12 pt-6 sm:grid sm:place-items-center sm:px-8">
      <div className="mx-auto w-full max-w-sm sm:max-w-md">
        <div className="mb-9 flex h-11 items-center justify-between">
          <Link to="/account-type" aria-label="Go back" className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-muted"><ArrowLeft className="size-[18px]" strokeWidth={1.75} /></Link>
          <span className="section-label">Step 3 of 3</span>
        </div>
        <div className="mb-7 grid size-12 place-items-center rounded-full bg-brand/15 text-brand-strong"><ShieldCheck className="size-6" strokeWidth={1.75} /></div>
        <div className="mb-8">
          <h1 className="display-title text-[2rem]">Verify your FUTA identity</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">A FUTAMOVE administrator reviews every submission. Only verified students are matched into shared rides.</p>
        </div>

        {!authLoading && !user && <p className="rounded-card border border-border p-4 text-sm">Please <Link to="/login" className="font-semibold underline">sign in</Link> to submit verification.</p>}

        {status === "rejected" && profile.data?.rejection_reason && (
          <div role="alert" className="mb-6 rounded-card border border-destructive/25 bg-destructive/5 p-4 text-sm">
            <p className="font-semibold text-destructive">{VERIFICATION_LABEL.rejected}</p>
            <p className="mt-1 text-foreground">{profile.data.rejection_reason}</p>
          </div>
        )}

        {locked ? (
          <div className="rounded-card border border-border p-5">
            <p className="font-semibold">{VERIFICATION_LABEL[status!]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{status === "verified" ? "Your FUTA identity is confirmed." : "Your details are with our team. You'll be able to join shared rides once approved."}</p>
            <Button asChild className="mt-5 w-full"><Link to="/student/home">Go to home</Link></Button>
          </div>
        ) : user && (
          <form onSubmit={submit} noValidate>
            <div className="space-y-5">
              <ImagePicker id="avatar" label="Profile photo" hint="A clear photo of your face" icon={Camera} file={avatar} onChange={setAvatar} error={errors.avatar} round />
              <div><Label htmlFor="fullName" className="text-[0.8125rem] font-medium">Full name</Label><Input id="fullName" className="mt-2" value={fullName} aria-invalid={!!errors.fullName} onChange={(e) => setFullName(e.target.value)} />{errors.fullName && <FieldError>{errors.fullName}</FieldError>}</div>
              <div><Label htmlFor="matric" className="text-[0.8125rem] font-medium">Matric number</Label><Input id="matric" placeholder="e.g. MEE/20/0000" className="mt-2" value={matric} aria-invalid={!!errors.matric} onChange={(e) => setMatric(e.target.value)} />{errors.matric && <FieldError>{errors.matric}</FieldError>}</div>
              <div><Label htmlFor="faculty" className="text-[0.8125rem] font-medium">Faculty</Label><Input id="faculty" placeholder="Your faculty" className="mt-2" value={faculty} aria-invalid={!!errors.faculty} onChange={(e) => setFaculty(e.target.value)} />{errors.faculty && <FieldError>{errors.faculty}</FieldError>}</div>
              <ImagePicker id="idCard" label="FUTA student ID card" hint="Photo of the front of your ID card" icon={IdCard} file={idCard} onChange={setIdCard} error={errors.idCard} />
            </div>
            {errors.form && <p role="alert" className="mt-5 rounded-card border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{errors.form}</p>}
            <Button type="submit" size="lg" className="mt-8 w-full" disabled={loading}>{loading ? "Uploading securely…" : status === "rejected" ? "Resubmit for verification" : "Submit for verification"}</Button>
          </form>
        )}
        <div className="mt-6"><TrustNote>Your ID card is stored privately and is only visible to you and FUTAMOVE verification staff.</TrustNote></div>
        <div className="mt-6 flex justify-center"><Brand compact /></div>
      </div>
    </main>
  );
}
