import { friendlyMessage } from "@/lib/friendly-error";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, Enums } from "@/integrations/supabase/types";

/** One authoritative FUTAMOVE location. Every active location works as both current location and destination. */
export type FutaLocation = Tables<"locations">;
export type LocationCategory = Enums<"location_category">;

export const CATEGORY_LABELS: Record<LocationCategory, string> = {
  GATE: "Gates",
  ACADEMIC: "Schools & Academic Locations",
  HOSTEL: "Hostels",
};
export const CATEGORY_ORDER: LocationCategory[] = ["GATE", "ACADEMIC", "HOSTEL"];
export const LOCATION_TYPES = ["gate", "school", "academic_building", "library", "health_centre", "student_union", "hostel"] as const;

/** Active locations for student selectors (RLS also hides inactive ones from non-admins). */
export async function listActiveLocations(): Promise<FutaLocation[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .eq("active", true)
    .order("category")
    .order("display_order")
    .order("name");
  if (error) throw new Error(friendlyMessage(error.message));
  return data ?? [];
}

/** Admin: all locations, active and inactive. */
export async function listAllLocations(): Promise<FutaLocation[]> {
  const { data, error } = await supabase.from("locations").select("*").order("category").order("display_order").order("name");
  if (error) throw new Error(friendlyMessage(error.message));
  return data ?? [];
}

export type LocationInput = Omit<TablesInsert<"locations">, "id" | "created_at" | "updated_at">;

export async function saveLocation(id: string | null, input: LocationInput): Promise<void> {
  const { error } = id
    ? await supabase.from("locations").update(input).eq("id", id)
    : await supabase.from("locations").insert(input);
  if (error) throw new Error(friendlyMessage(error.message));
}

export async function setLocationActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("locations").update({ active }).eq("id", id);
  if (error) throw new Error(friendlyMessage(error.message));
}

export async function uploadLocationImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller.");
  const path = `${crypto.randomUUID()}.${file.name.split(".").pop() || "jpg"}`;
  const { error } = await supabase.storage.from("location-images").upload(path, file, { contentType: file.type });
  if (error) throw new Error(friendlyMessage(error.message));
  return path;
}

/** image_url holds either a storage path in the private bucket or an external https URL. */
export async function locationImageSrc(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  if (/^https?:\/\//.test(imageUrl)) return imageUrl;
  const { data } = await supabase.storage.from("location-images").createSignedUrl(imageUrl, 600);
  return data?.signedUrl ?? null;
}
