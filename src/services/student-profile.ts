import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type StudentProfile = Tables<"student_profiles">;

export async function getMyStudentProfile(): Promise<StudentProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from("student_profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Saves matric/faculty for review. Verification status can only be set by FUTAMOVE, never by the student. */
export async function submitVerification(input: { matricNumber: string; faculty: string }): Promise<void> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("You need to be signed in to submit verification.");
  const fullName = (auth.user.user_metadata?.["full_name"] as string | undefined) ?? null;
  const { error } = await supabase.from("student_profiles").upsert({
    id: auth.user.id,
    full_name: fullName,
    matric_number: input.matricNumber.trim(),
    faculty: input.faculty.trim(),
  });
  if (error) throw new Error(`We couldn't submit your details. ${error.message}`);
}
