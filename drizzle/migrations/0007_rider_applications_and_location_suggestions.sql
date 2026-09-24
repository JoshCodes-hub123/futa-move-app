-- ===== Rider applications =====
CREATE TYPE public.rider_application_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');

CREATE TABLE public.rider_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 120),
  phone text NOT NULL CHECK (length(btrim(phone)) BETWEEN 7 AND 20),
  avatar_path text NOT NULL,
  id_type text CHECK (id_type IS NULL OR length(id_type) <= 60),
  id_number text CHECK (id_number IS NULL OR length(id_number) <= 60),
  id_document_path text,
  vehicle_description text NOT NULL CHECK (length(btrim(vehicle_description)) BETWEEN 2 AND 160),
  plate_number text CHECK (plate_number IS NULL OR length(plate_number) <= 20),
  vehicle_photo_path text,
  status public.rider_application_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one live (pending/approved/suspended) application per account; rejected ones stay as history.
CREATE UNIQUE INDEX rider_applications_one_live ON public.rider_applications (user_id) WHERE status IN ('pending', 'approved', 'suspended');
CREATE INDEX rider_applications_status_idx ON public.rider_applications (status, created_at);

GRANT SELECT ON public.rider_applications TO authenticated;
GRANT ALL ON public.rider_applications TO service_role;
ALTER TABLE public.rider_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Applicants read own rider applications" ON public.rider_applications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read rider applications" ON public.rider_applications FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER rider_applications_updated_at BEFORE UPDATE ON public.rider_applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Role detection: 'applicant' = has a rider application but no active role (pending, rejected or suspended).
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'admin') THEN 'admin'
    WHEN public.has_role(auth.uid(), 'rider') THEN 'rider'
    WHEN public.has_role(auth.uid(), 'student') THEN 'student'
    WHEN EXISTS (SELECT 1 FROM public.rider_applications WHERE user_id = auth.uid()) THEN 'applicant'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.submit_rider_application(
  p_full_name text, p_phone text, p_avatar_path text, p_id_type text, p_id_number text, p_id_document_path text,
  p_vehicle_description text, p_plate_number text, p_vehicle_photo_path text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('rider:' || uid::text));
  IF public.has_role(uid, 'admin') THEN RAISE EXCEPTION 'Administrator accounts cannot apply as riders'; END IF;
  IF public.has_role(uid, 'rider') THEN RAISE EXCEPTION 'You are already an approved rider'; END IF;
  IF EXISTS (SELECT 1 FROM public.rider_applications WHERE user_id = uid AND status IN ('pending', 'approved', 'suspended')) THEN
    RAISE EXCEPTION 'You already have a rider application in progress';
  END IF;
  IF coalesce(btrim(p_full_name), '') = '' OR coalesce(btrim(p_phone), '') = '' OR coalesce(btrim(p_vehicle_description), '') = '' THEN
    RAISE EXCEPTION 'Full name, phone number and keke details are required';
  END IF;
  IF btrim(p_phone) !~ '^\+?[0-9 ()-]{7,20}$' THEN RAISE EXCEPTION 'Enter a valid phone number'; END IF;
  IF p_avatar_path IS NULL OR split_part(p_avatar_path, '/', 1) <> uid::text
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'rider-documents' AND name = p_avatar_path) THEN
    RAISE EXCEPTION 'Profile photo upload not found';
  END IF;
  IF p_id_document_path IS NOT NULL AND (split_part(p_id_document_path, '/', 1) <> uid::text
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'rider-documents' AND name = p_id_document_path)) THEN
    RAISE EXCEPTION 'ID document upload not found';
  END IF;
  IF p_vehicle_photo_path IS NOT NULL AND (split_part(p_vehicle_photo_path, '/', 1) <> uid::text
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'rider-documents' AND name = p_vehicle_photo_path)) THEN
    RAISE EXCEPTION 'Keke photo upload not found';
  END IF;
  INSERT INTO public.rider_applications (user_id, full_name, phone, avatar_path, id_type, id_number, id_document_path, vehicle_description, plate_number, vehicle_photo_path)
  VALUES (uid, btrim(p_full_name), btrim(p_phone), p_avatar_path, nullif(btrim(p_id_type), ''), nullif(btrim(p_id_number), ''), p_id_document_path,
          btrim(p_vehicle_description), nullif(upper(btrim(p_plate_number)), ''), p_vehicle_photo_path)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- p_action: approve | reject | suspend | restore. Role changes happen only here.
CREATE OR REPLACE FUNCTION public.review_rider_application(p_application_id uuid, p_action text, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE app public.rider_applications; reviewer uuid := auth.uid();
BEGIN
  IF reviewer IS NULL OR NOT public.has_role(reviewer, 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  SELECT * INTO app FROM public.rider_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF p_action = 'approve' THEN
    IF app.status <> 'pending' THEN RAISE EXCEPTION 'Only pending applications can be approved'; END IF;
    UPDATE public.rider_applications SET status = 'approved', rejection_reason = NULL, reviewed_by = reviewer, reviewed_at = now() WHERE id = app.id;
    INSERT INTO public.user_roles (user_id, role) VALUES (app.user_id, 'rider') ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF p_action = 'reject' THEN
    IF app.status <> 'pending' THEN RAISE EXCEPTION 'Only pending applications can be rejected'; END IF;
    IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    UPDATE public.rider_applications SET status = 'rejected', rejection_reason = left(btrim(p_reason), 500), reviewed_by = reviewer, reviewed_at = now() WHERE id = app.id;
  ELSIF p_action = 'suspend' THEN
    IF app.status <> 'approved' THEN RAISE EXCEPTION 'Only approved riders can be suspended'; END IF;
    UPDATE public.rider_applications SET status = 'suspended', rejection_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''), reviewed_by = reviewer, reviewed_at = now() WHERE id = app.id;
    DELETE FROM public.user_roles WHERE user_id = app.user_id AND role = 'rider';
  ELSIF p_action = 'restore' THEN
    IF app.status <> 'suspended' THEN RAISE EXCEPTION 'Only suspended riders can be restored'; END IF;
    UPDATE public.rider_applications SET status = 'approved', rejection_reason = NULL, reviewed_by = reviewer, reviewed_at = now() WHERE id = app.id;
    INSERT INTO public.user_roles (user_id, role) VALUES (app.user_id, 'rider') ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'Unknown action';
  END IF;
END;
$$;

-- Admin list including the applicant's sign-in email.
CREATE OR REPLACE FUNCTION public.admin_list_rider_applications()
 RETURNS TABLE (id uuid, user_id uuid, email text, full_name text, phone text, avatar_path text, id_type text, id_number text, id_document_path text,
   vehicle_description text, plate_number text, vehicle_photo_path text, status public.rider_application_status, rejection_reason text,
   reviewed_at timestamptz, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN QUERY SELECT a.id, a.user_id, u.email::text, a.full_name, a.phone, a.avatar_path, a.id_type, a.id_number, a.id_document_path,
    a.vehicle_description, a.plate_number, a.vehicle_photo_path, a.status, a.rejection_reason, a.reviewed_at, a.created_at
  FROM public.rider_applications a LEFT JOIN auth.users u ON u.id = a.user_id
  ORDER BY a.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_rider_application(text, text, text, text, text, text, text, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.review_rider_application(uuid, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_list_rider_applications() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.submit_rider_application(text, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_rider_application(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_rider_applications() TO authenticated;

CREATE POLICY "Applicants upload own rider documents" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rider-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Applicants read own rider documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rider-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Admins read rider documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rider-documents' AND public.has_role(auth.uid(), 'admin'));

-- ===== Location suggestions =====
CREATE TYPE public.location_suggestion_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.location_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by uuid NOT NULL,
  submitter_role text NOT NULL CHECK (submitter_role IN ('student', 'rider')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  category public.location_category NOT NULL,
  description text CHECK (description IS NULL OR length(description) <= 500),
  latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  google_place_id text CHECK (google_place_id IS NULL OR length(google_place_id) <= 200),
  image_path text,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  status public.location_suggestion_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  approved_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_suggestions_coords_pair CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX location_suggestions_status_idx ON public.location_suggestions (status, created_at);
CREATE INDEX location_suggestions_submitter_idx ON public.location_suggestions (submitted_by, created_at);

GRANT SELECT ON public.location_suggestions TO authenticated;
GRANT ALL ON public.location_suggestions TO service_role;
ALTER TABLE public.location_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Submitters read own suggestions" ON public.location_suggestions FOR SELECT TO authenticated USING (auth.uid() = submitted_by);
CREATE POLICY "Admins read suggestions" ON public.location_suggestions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER location_suggestions_updated_at BEFORE UPDATE ON public.location_suggestions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.submit_location_suggestion(
  p_name text, p_category public.location_category, p_description text, p_latitude double precision, p_longitude double precision,
  p_google_place_id text, p_image_path text, p_reason text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); r text; new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  r := CASE WHEN public.has_role(uid, 'rider') THEN 'rider' WHEN public.has_role(uid, 'student') THEN 'student' ELSE NULL END;
  IF r IS NULL THEN RAISE EXCEPTION 'Only students and approved riders can suggest locations'; END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN RAISE EXCEPTION 'Enter both latitude and longitude, or neither'; END IF;
  IF p_image_path IS NOT NULL AND (split_part(p_image_path, '/', 1) <> uid::text
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'location-suggestion-images' AND name = p_image_path)) THEN
    RAISE EXCEPTION 'Photo upload not found';
  END IF;
  IF (SELECT count(*) FROM public.location_suggestions WHERE submitted_by = uid AND status = 'pending') >= 10 THEN
    RAISE EXCEPTION 'You already have 10 suggestions waiting for review';
  END IF;
  INSERT INTO public.location_suggestions (submitted_by, submitter_role, name, category, description, latitude, longitude, google_place_id, image_path, reason)
  VALUES (uid, r, btrim(p_name), p_category, nullif(btrim(p_description), ''), p_latitude, p_longitude, nullif(btrim(p_google_place_id), ''), p_image_path, btrim(p_reason))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- p_mode: create | update_existing | use_existing. Always writes into the single authoritative locations table.
CREATE OR REPLACE FUNCTION public.approve_location_suggestion(
  p_suggestion_id uuid, p_mode text, p_location_id uuid, p_name text, p_category public.location_category, p_location_type text,
  p_description text, p_latitude double precision, p_longitude double precision, p_google_place_id text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s public.location_suggestions; reviewer uuid := auth.uid(); loc_id uuid;
BEGIN
  IF reviewer IS NULL OR NOT public.has_role(reviewer, 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  SELECT * INTO s FROM public.location_suggestions WHERE id = p_suggestion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion not found'; END IF;
  IF s.status <> 'pending' THEN RAISE EXCEPTION 'This suggestion has already been reviewed'; END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN RAISE EXCEPTION 'Enter both latitude and longitude, or neither'; END IF;
  IF p_mode = 'create' THEN
    IF coalesce(btrim(p_name), '') = '' OR coalesce(btrim(p_location_type), '') = '' THEN RAISE EXCEPTION 'Name and type are required'; END IF;
    INSERT INTO public.locations (name, category, location_type, description, latitude, longitude, google_place_id, active, display_order)
    VALUES (btrim(p_name), p_category, btrim(p_location_type), nullif(btrim(p_description), ''), p_latitude, p_longitude, nullif(btrim(p_google_place_id), ''), true,
            coalesce((SELECT max(display_order) + 1 FROM public.locations), 0))
    RETURNING id INTO loc_id;
  ELSIF p_mode = 'update_existing' THEN
    IF p_location_id IS NULL THEN RAISE EXCEPTION 'Choose the existing location'; END IF;
    UPDATE public.locations SET
      name = coalesce(nullif(btrim(p_name), ''), name),
      category = coalesce(p_category, category),
      location_type = coalesce(nullif(btrim(p_location_type), ''), location_type),
      description = coalesce(nullif(btrim(p_description), ''), description),
      latitude = CASE WHEN p_latitude IS NULL THEN latitude ELSE p_latitude END,
      longitude = CASE WHEN p_latitude IS NULL THEN longitude ELSE p_longitude END,
      google_place_id = coalesce(nullif(btrim(p_google_place_id), ''), google_place_id),
      active = true
    WHERE id = p_location_id RETURNING id INTO loc_id;
    IF loc_id IS NULL THEN RAISE EXCEPTION 'Existing location not found'; END IF;
  ELSIF p_mode = 'use_existing' THEN
    SELECT id INTO loc_id FROM public.locations WHERE id = p_location_id;
    IF loc_id IS NULL THEN RAISE EXCEPTION 'Existing location not found'; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown approval mode';
  END IF;
  UPDATE public.location_suggestions SET status = 'approved', approved_location_id = loc_id, rejection_reason = NULL, reviewed_by = reviewer, reviewed_at = now() WHERE id = s.id;
  RETURN loc_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_location_suggestion(p_suggestion_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE reviewer uuid := auth.uid();
BEGIN
  IF reviewer IS NULL OR NOT public.has_role(reviewer, 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  UPDATE public.location_suggestions SET status = 'rejected', rejection_reason = left(btrim(p_reason), 500), reviewed_by = reviewer, reviewed_at = now()
  WHERE id = p_suggestion_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion not found or already reviewed'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_location_suggestion(text, public.location_category, text, double precision, double precision, text, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.approve_location_suggestion(uuid, text, uuid, text, public.location_category, text, text, double precision, double precision, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reject_location_suggestion(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.submit_location_suggestion(text, public.location_category, text, double precision, double precision, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_location_suggestion(uuid, text, uuid, text, public.location_category, text, text, double precision, double precision, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_location_suggestion(uuid, text) TO authenticated;

CREATE POLICY "Submitters upload own suggestion images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'location-suggestion-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Submitters read own suggestion images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'location-suggestion-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Admins read suggestion images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'location-suggestion-images' AND public.has_role(auth.uid(), 'admin'));