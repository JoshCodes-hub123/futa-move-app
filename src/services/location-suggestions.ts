import { imageExtension } from "@/lib/image-ext";
import { friendlyMessage } from "@/lib/friendly-error";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables } from "@/integrations/supabase/types";
import type { FutaLocation, LocationCategory } from "@/services/locations";

export type LocationSuggestion = Tables<"location_suggestions">;
export type SuggestionStatus = Database["public"]["Enums"]["location_suggestion_status"];

export async function listMySuggestions(): Promise<LocationSuggestion[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase.from("location_suggestions").select("*").eq("submitted_by", auth.user.id).order("created_at", { ascending: false });
  if (error) throw new Error(friendlyMessage(error.message));
  return data ?? [];
}

export type SuggestionInput = {
  name: string; category: LocationCategory; description: string; latitude: number | null; longitude: number | null;
  googlePlaceId: string; reason: string; photo: File | null;
};

export async function submitSuggestion(input: SuggestionInput): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("You need to be signed in.");
  let imagePath: string | null = null;
  if (input.photo) {
    const ext = imageExtension(input.photo);
    imagePath = `${auth.user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await supabase.storage.from("location-suggestion-images").upload(imagePath, input.photo, { contentType: input.photo.type, upsert: false });
    if (error) throw new Error(`Photo upload failed. ${friendlyMessage(friendlyMessage(error.message))}`);
  }
  const { error } = await supabase.rpc("submit_location_suggestion", {
    p_name: input.name, p_category: input.category, p_description: input.description,
    p_latitude: input.latitude as number, p_longitude: input.longitude as number,
    p_google_place_id: input.googlePlaceId, p_image_path: imagePath as string, p_reason: input.reason,
  });
  if (error) throw new Error(friendlyMessage(error.message));
}

export async function suggestionImageUrl(path: string | null) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("location-suggestion-images").createSignedUrl(path, 300);
  return error ? null : data.signedUrl;
}

// ===== Admin =====
export async function adminListSuggestions(): Promise<LocationSuggestion[]> {
  const { data, error } = await supabase.from("location_suggestions").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(friendlyMessage(error.message));
  return data ?? [];
}

export type ApproveInput = {
  mode: "create" | "update_existing" | "use_existing"; locationId: string | null; name: string; category: LocationCategory;
  locationType: string; description: string; latitude: number | null; longitude: number | null; googlePlaceId: string;
};

export async function approveSuggestion(id: string, input: ApproveInput) {
  const { error } = await supabase.rpc("approve_location_suggestion", {
    p_suggestion_id: id, p_mode: input.mode, p_location_id: input.locationId as string, p_name: input.name,
    p_category: input.category, p_location_type: input.locationType, p_description: input.description,
    p_latitude: input.latitude as number, p_longitude: input.longitude as number, p_google_place_id: input.googlePlaceId,
  });
  if (error) throw new Error(friendlyMessage(error.message));
}

export async function rejectSuggestion(id: string, reason: string) {
  const { error } = await supabase.rpc("reject_location_suggestion", { p_suggestion_id: id, p_reason: reason });
  if (error) throw new Error(friendlyMessage(error.message));
}

const STOP = new Set(["futa", "the", "of", "and", "main", "entrance", "gate", "hall", "hostel", "building", "new", "old"]);
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));

/** Existing locations (active or inactive) whose names look like the suggestion. Admin decides. */
export function findPossibleDuplicates(name: string, locations: FutaLocation[]): FutaLocation[] {
  const n = name.toLowerCase().trim();
  const t = new Set(tokens(name));
  return locations.filter((l) => {
    const names = [l.name, l.official_name ?? ""].map((x) => x.toLowerCase().trim()).filter(Boolean);
    if (names.some((x) => x === n || x.includes(n) || n.includes(x))) return true;
    const lt = tokens(names.join(" "));
    return lt.some((x) => t.has(x));
  });
}
