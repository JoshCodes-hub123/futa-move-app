CREATE POLICY "Private buckets accept image files only"
ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated, anon
WITH CHECK (
  bucket_id NOT IN ('profile-photos','student-id-cards','location-images','rider-documents','location-suggestion-images')
  OR lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','heic','heif','gif')
);
CREATE POLICY "Private buckets keep image files only on update"
ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated, anon
USING (true)
WITH CHECK (
  bucket_id NOT IN ('profile-photos','student-id-cards','location-images','rider-documents','location-suggestion-images')
  OR lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','heic','heif','gif')
);