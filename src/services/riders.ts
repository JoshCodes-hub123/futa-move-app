import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables } from "@/integrations/supabase/types";

export type RiderApplication = Tables<"rider_applications">;
export type RiderApplicationStatus = Database["public"]["Enums"]["rider_application_status"];
export type AdminRiderApplication = Database["public"]["Functions"]["admin_list_rider_applications"]["Returns"][number];

export const RIDER_STATUS_LABEL: Record<RiderApplicationStatus, string> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};

const MAX_BYTES = 8 * 1024 * 1024;
export function validateRiderImage(file: File | null, label: string, required: boolean): string | null {
  if (!file) return required ? `Add your ${label}.` : null;
  if (!file.type.startsWith("image/")) return `Your ${label} must be an image (JPG, PNG or WEBP).`;
  if (file.size > MAX_BYTES) return `Your ${label} must be under 8MB.`;
  return null;
}

/** Latest application for the signed-in account (history kept; newest first). */
export async function getMyRiderApplication(): Promise<RiderApplication | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from("rider_applications").select("*").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function upload(userId: string, file: File, kind: string) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supabase.storage.from("rider-documents").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Upload failed. ${error.message}`);
  return path;
}

export type RiderApplicationInput = {
  fullName: string; phone: string; avatar: File; idType: string; idNumber: string; idDocument: File | null;
  vehicleDescription: string; plateNumber: string; vehiclePhoto: File | null;
};

export async function submitRiderApplication(input: RiderApplicationInput): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("You need to be signed in.");
  const uid = auth.user.id;
  const avatarPath = await upload(uid, input.avatar, "photo");
  const idPath = input.idDocument ? await upload(uid, input.idDocument, "id") : null;
  const vehiclePath = input.vehiclePhoto ? await upload(uid, input.vehiclePhoto, "keke") : null;
  const { error } = await supabase.rpc("submit_rider_application", {
    p_full_name: input.fullName, p_phone: input.phone, p_avatar_path: avatarPath,
    p_id_type: input.idType, p_id_number: input.idNumber, p_id_document_path: idPath as string,
    p_vehicle_description: input.vehicleDescription, p_plate_number: input.plateNumber, p_vehicle_photo_path: vehiclePath as string,
  });
  if (error) throw new Error(error.message);
}

export async function riderDocumentUrl(path: string | null | undefined, seconds = 300) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("rider-documents").createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

// ===== Admin =====
export async function adminListRiderApplications(): Promise<AdminRiderApplication[]> {
  const { data, error } = await supabase.rpc("admin_list_rider_applications");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function reviewRiderApplication(id: string, action: "approve" | "reject" | "suspend" | "restore", reason?: string) {
  const { error } = await supabase.rpc("review_rider_application", { p_application_id: id, p_action: action, p_reason: reason ?? "" });
  if (error) throw new Error(error.message);
}
