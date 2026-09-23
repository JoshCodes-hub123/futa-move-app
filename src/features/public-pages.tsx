import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Bike, Check, GraduationCap, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { Brand } from "@/components/futamove/brand";
import { TrustNote } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

function PublicShell({ children, back, step }: { children: React.ReactNode; back?: string; step?: string }) {
  return (
    <main className="min-h-screen bg-background px-5 pb-12 pt-6 sm:grid sm:place-items-center sm:px-8">
      <div className="mx-auto w-full max-w-sm sm:max-w-md">
        <div className="mb-9 flex h-11 items-center justify-between">
          {back ? <Link to={back} aria-label="Go back" className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-[18px]" strokeWidth={1.75} /></Link> : <Brand compact />}
          {step && <span className="section-label">{step}</span>}
        </div>
        {children}
      </div>
    </main>
  );
}

function PageIntro({ title, description }: { title: string; description: string }) {
  return <div className="mb-9"><h1 className="display-title text-[2rem]">{title}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p></div>;
}

export function WelcomePage() {
  return <main className="flex min-h-screen flex-col bg-dark-surface px-6 pb-10 pt-10 text-dark-foreground"><div className="mx-auto flex w-full max-w-sm flex-1 flex-col sm:max-w-md"><Brand className="[&_p]:text-dark-foreground" /><div className="my-auto py-14"><span className="inline-flex items-center rounded-full border border-dark-border px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-brand">FUTA campus mobility</span><h1 className="display-title mt-7 text-[2.75rem] sm:text-[3.25rem]">Where are you<br />going?</h1><p className="mt-6 max-w-xs text-[0.9375rem] leading-7 text-dark-muted">Find and share keke rides with verified FUTA students heading your way.</p></div><div className="space-y-3"><Button asChild size="lg" className="w-full"><Link to="/signup">Create student account <ArrowRight /></Link></Button><Button asChild size="lg" variant="dark-outline" className="w-full"><Link to="/login">I already have an account</Link></Button><p className="pt-4 text-center text-xs text-dark-muted">For verified FUTA students and campus riders.</p></div></div></main>;
}

function Field({ id, label, icon: Icon, ...props }: { id: string; label: string; icon: typeof Mail } & React.ComponentProps<"input">) {
  return <div><Label htmlFor={id} className="text-[0.8125rem] font-medium">{label}</Label><div className="relative mt-2"><Icon className="field-icon" strokeWidth={1.75} /><Input id={id} className="pl-11" {...props} /></div></div>;
}

function AuthFields({ signup, name, email, password, onNameChange, onEmailChange, onPasswordChange }: { signup?: boolean; name?: string; email: string; password: string; onNameChange?: (value: string) => void; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void }) {
  return <div className="space-y-5">{signup && <Field id="name" label="Full name" icon={UserRound} placeholder="Your full name" value={name ?? ""} onChange={(event) => onNameChange?.(event.target.value)} />}<Field id="email" label="FUTA email" icon={Mail} type="email" placeholder="name@futa.edu.ng" value={email} onChange={(event) => onEmailChange(event.target.value)} /><Field id="password" label="Password" icon={LockKeyhole} type="password" placeholder="At least 8 characters" value={password} onChange={(event) => onPasswordChange(event.target.value)} /></div>;
}

function AuthError({ message }: { message: string | null }) { return message ? <p role="alert" className="mt-5 rounded-card border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{message}</p> : null; }

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) { setError(authError.message); setLoading(false); return; }
    await navigate({ to: "/student/home" });
  }
  return <PublicShell back="/"><PageIntro title="Welcome back" description="Sign in to continue moving around FUTA." /><form onSubmit={submit}><AuthFields email={email} password={password} onEmailChange={setEmail} onPasswordChange={setPassword} /><AuthError message={error} /><Button type="submit" size="lg" className="mt-8 w-full" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button></form><p className="mt-7 text-center text-sm text-muted-foreground">New to FUTAMOVE? <Link to="/signup" className="font-semibold text-foreground underline-offset-4 hover:underline">Create account</Link></p></PublicShell>;
}

export function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    if (!name.trim() || !email.trim() || password.length < 8) { setError("Enter your name, a valid email, and a password of at least 8 characters."); return; }
    setLoading(true);
    const { error: authError } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() } } });
    if (authError) { setError(authError.message); setLoading(false); return; }
    await navigate({ to: "/account-type" });
  }
  return <PublicShell back="/" step="Step 1 of 3"><PageIntro title="Join FUTAMOVE" description="Use your student details to get started." /><form onSubmit={submit}><AuthFields signup name={name} email={email} password={password} onNameChange={setName} onEmailChange={setEmail} onPasswordChange={setPassword} /><AuthError message={error} /><Button type="submit" size="lg" className="mt-8 w-full" disabled={loading}>{loading ? "Creating account…" : "Continue"}</Button></form><div className="mt-6"><TrustNote>Your account will be verified before you can join rides.</TrustNote></div><p className="mt-7 text-center text-sm text-muted-foreground">Already have an account? <Link to="/login" className="font-semibold text-foreground underline-offset-4 hover:underline">Sign in</Link></p></PublicShell>;
}

export function AccountTypePage() {
  const [selected, setSelected] = useState<"student" | "rider">("student");
  const options = [{ key: "student", icon: GraduationCap, title: "Student", detail: "Find and share rides around FUTA" }, { key: "rider", icon: Bike, title: "Rider", detail: "Receive requests and manage trips" }] as const;
  return <PublicShell back="/signup" step="Step 2 of 3"><PageIntro title="How will you move?" description="Choose your primary account type. You can complete setup next." /><div className="grid gap-3">{options.map(({ key, icon: Icon, title, detail }) => { const active = selected === key; return <button key={key} type="button" aria-pressed={active} onClick={() => setSelected(key)} className={`selection-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active ? "selection-card-active" : "hover:bg-muted/50"}`}><span className="grid size-10 place-items-center rounded-full bg-muted"><Icon className="size-5" strokeWidth={1.75} /></span><span><strong>{title}</strong><small>{detail}</small></span><span className={`grid size-5 place-items-center rounded-full border transition-colors ${active ? "border-brand bg-brand text-primary-foreground" : "border-border"}`}>{active && <Check className="size-3" strokeWidth={3} />}</span></button>; })}</div><Button asChild size="lg" className="mt-8 w-full"><Link to="/verification">Continue <ArrowRight /></Link></Button></PublicShell>;
}

export function VerificationPage() { return <PublicShell back="/account-type" step="Step 3 of 3"><div className="mb-7 grid size-12 place-items-center rounded-full bg-brand/15 text-brand-strong"><ShieldCheck className="size-6" strokeWidth={1.75} /></div><PageIntro title="Verify your FUTA identity" description="This helps everyone ride with greater confidence." /><div className="space-y-5"><div><Label htmlFor="matric" className="text-[0.8125rem] font-medium">Matric number</Label><Input id="matric" placeholder="e.g. MEE/20/0000" className="mt-2" /></div><div><Label htmlFor="faculty" className="text-[0.8125rem] font-medium">Faculty</Label><Input id="faculty" placeholder="Your faculty" className="mt-2" /></div></div><Button asChild size="lg" className="mt-8 w-full"><Link to="/student/home">Submit for verification</Link></Button><div className="mt-6"><TrustNote>Verification usually takes a short while after submission.</TrustNote></div></PublicShell>; }
