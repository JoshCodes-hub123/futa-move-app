/** Storage only accepts these image extensions (enforced server-side too). */
const BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif", "image/gif": "gif",
};

export function imageExtension(file: File): string {
  const fromType = BY_TYPE[file.type.toLowerCase()];
  if (fromType) return fromType;
  const fromName = (file.name.includes(".") ? file.name.split(".").pop() ?? "" : "").toLowerCase();
  return Object.values(BY_TYPE).includes(fromName) || fromName === "jpeg" ? fromName : "jpg";
}
