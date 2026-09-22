import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Bike, GraduationCap, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { Brand } from "@/components/futamove/brand";
import { TrustNote } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function PublicShell({ children, back }: { children: React.ReactNode; back?: string }) {
  return <main className="min-h-screen bg-app-canvas px-4 py-6 sm:grid sm:place-items-center"><div className="mx-auto w-full max-w-md">{back ? <Link to={back} className="mb-8 inline-flex size-10 items-center justify-center rounded-full border border-border bg-background" aria-label="Go back"><ArrowLeft className="size-5" /></Link> : <Brand compact className="mb-10" />}{children}</div></main>;
}

export function WelcomePage() {
  return <main className="flex min-h-screen flex-col bg-dark-surface px-5 pb-8 pt-10 text-dark-foreground"><div className="mx-auto flex w-full max-w-md flex-1 flex-col"><Brand className="[&_p]:text-dark-foreground" /><div className="my-auto py-12"><p className="mb-4 text-sm font-semibold text-brand">FUTA campus mobility</p><h1 className="text-4xl font-black leading-tight sm:text-5xl">Where are you going?</h1><p className="mt-5 max-w-sm text-base leading-7 text-dark-muted">Find and share keke rides with verified FUTA students heading your way.</p></div><div className="space-y-3"><Button asChild size="lg" className="w-full"><Link to="/signup">Create student account <ArrowRight /></Link></Button><Button asChild size="lg" variant="dark-outline" className="w-full"><Link to="/login">I already have an account</Link></Button><p className="pt-3 text-center text-xs text-dark-muted">For verified FUTA students and campus riders.</p></div></div></main>;
}

function AuthFields({ signup = false }: { signup?: boolean }) {
  return <div className="space-y-4">{signup && <div><Label htmlFor="name">Full name</Label><div className="relative mt-2"><UserRound className="field-icon" /><Input id="name" placeholder="Your full name" className="pl-11" /></div></div>}<div><Label htmlFor="email">FUTA email</Label><div className="relative mt-2"><Mail className="field-icon" /><Input id="email" type="email" placeholder="name@futa.edu.ng" className="pl-11" /></div></div><div><Label htmlFor="password">Password</Label><div className="relative mt-2"><LockKeyhole className="field-icon" /><Input id="password" type="password" placeholder="At least 8 characters" className="pl-11" /></div></div></div>;
}

export function LoginPage() {
  return <PublicShell back="/"><h1 className="text-3xl font-bold">Welcome back</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Sign in to continue moving around FUTA.</p><Card className="mt-8"><CardContent className="space-y-6 p-5"><AuthFields /><Button asChild size="lg" className="w-full"><Link to="/student/home">Sign in</Link></Button></CardContent></Card><p className="mt-6 text-center text-sm text-muted-foreground">New to FUTAMOVE? <Link to="/signup" className="font-semibold text-foreground">Create account</Link></p></PublicShell>;
}

export function SignupPage() {
  return <PublicShell back="/"><h1 className="text-3xl font-bold">Join FUTAMOVE</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Use your student details to get started.</p><Card className="mt-8"><CardContent className="space-y-6 p-5"><AuthFields signup /><Button asChild size="lg" className="w-full"><Link to="/account-type">Continue</Link></Button><TrustNote>Your account will be verified before you can join rides.</TrustNote></CardContent></Card><p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link to="/login" className="font-semibold text-foreground">Sign in</Link></p></PublicShell>;
}

export function AccountTypePage() {
  const [selected, setSelected] = useState<"student" | "rider">("student");
  return <PublicShell back="/signup"><h1 className="text-3xl font-bold">How will you move?</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Choose your primary account type. You can complete setup next.</p><div className="mt-8 grid gap-3"><button type="button" onClick={() => setSelected("student")} className={`selection-card ${selected === "student" ? "selection-card-active" : ""}`}><GraduationCap className="size-6" /><span><strong>Student</strong><small>Find and share rides around FUTA</small></span></button><button type="button" onClick={() => setSelected("rider")} className={`selection-card ${selected === "rider" ? "selection-card-active" : ""}`}><Bike className="size-6" /><span><strong>Rider</strong><small>Receive requests and manage trips</small></span></button></div><Button asChild size="lg" className="mt-8 w-full"><Link to="/verification">Continue <ArrowRight /></Link></Button></PublicShell>;
}

export function VerificationPage() {
  return <PublicShell back="/account-type"><div className="grid size-14 place-items-center rounded-full bg-primary"><ShieldCheck className="size-7" /></div><h1 className="mt-6 text-3xl font-bold">Verify your FUTA identity</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">This helps everyone ride with greater confidence.</p><Card className="mt-8"><CardContent className="space-y-5 p-5"><div><Label htmlFor="matric">Matric number</Label><Input id="matric" placeholder="e.g. MEE/20/0000" className="mt-2" /></div><div><Label htmlFor="faculty">Faculty</Label><Input id="faculty" placeholder="Your faculty" className="mt-2" /></div><Button asChild size="lg" className="w-full"><Link to="/student/home">Submit for verification</Link></Button></CardContent></Card></PublicShell>;
}