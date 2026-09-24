import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type StudentProfile = Tables<"student_profiles">;
export type VerificationSubmission = Tables<"verification_submissions">;
export type VerificationStatus = StudentProfile["verification_status"];

export const VERIFICATION_LABEL: Record<VerificationStatus | "none", string> = {
  none: "Verification not submitted",
  pending: "Pending Verification",
  verified: "Verified Student",
  rejected: "Verification requires resubmission",
};

const MAX_IMAGE_BYTES = { avatar: 5 * 1024 * 1024, idCard: 8 * 1024 * 1024 };

export async function getMyStudentProfile(): Promise<StudentProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from("student_profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Short-lived signed URL for a private image. RLS decides who may sign it. */
export async function signedImageUrl(bucket: "profile-photos" | "student-id-cards", path: string | null | undefined, seconds = 300) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) return null;
  return data.signedUrl;
}

export function validateImage(file: File | null, kind: "avatar" | "idCard"): string | null {
  const label = kind === "avatar" ? "profile photo" : "FUTA student ID card image";
  if (!file) return `Add your ${label}.`;
  if (!file.type.startsWith("image/")) return `Your ${label} must be an image (JPG, PNG or WEBP).`;
  if (file.size > MAX_IMAGE_BYTES[kind]) return `Your ${label} must be under ${MAX_IMAGE_BYTES[kind] / 1024 / 1024}MB.`;
  return null;
}

async function upload(bucket: "profile-photos" | "student-id-cards", userId: string, file: File) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Upload failed. ${error.message}`);
  return path;
}

/**
 * Uploads the photo + ID card privately, then submits through the server-controlled
 * submit_verification function. Status is always set to pending by the database.
 */
export async function submitVerification(input: { fullName: string; matricNumber: string; faculty: string; avatar: File; idCard: File }): Promise<void> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("You need to be signed in to submit verification.");
  const avatarPath = await upload("profile-photos", auth.user.id, input.avatar);
  const idCardPath = await upload("student-id-cards", auth.user.id, input.idCard);
  const { error } = await supabase.rpc("submit_verification", {
    p_full_name: input.fullName,
    p_matric: input.matricNumber,
    p_faculty: input.faculty,
    p_avatar_path: avatarPath,
    p_id_card_path: idCardPath,
  });
  if (error) throw new Error(`We couldn't submit your details. ${error.message}`);
}

// ===== Admin =====
export async function amIAdmin(): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await supabase.rpc("has_role", { _user_id: auth.user.id, _role: "admin" });
  if (error) return false;
  return data === true;
}

export async function listPendingSubmissions(): Promise<VerificationSubmission[]> {
  const { data, error } = await supabase.from("verification_submissions").select("*").eq("status", "pending").order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

export async function reviewSubmission(id: string, approve: boolean, reason?: string) {
  const { error } = await supabase.rpc("review_verification", { p_submission_id: id, p_approve: approve, ...(reason ? { p_reason: reason } : {}) });
  if (error) throw new Error(error.message);
}
