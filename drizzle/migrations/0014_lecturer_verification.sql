ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'student' CHECK (account_type IN ('student','lecturer')),
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS phone text;
COMMENT ON TABLE public.student_profiles IS 'Passenger profiles for verified FUTA students and lecturers (account_type). matric_number holds the staff ID for lecturers.';

ALTER TABLE public.verification_submissions
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'student' CHECK (account_type IN ('student','lecturer')),
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS academic_title text;

-- account_type on profiles is server-controlled.
CREATE OR REPLACE FUNCTION public.student_profiles_verification_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending'; NEW.verified_at := NULL;
    NEW.account_type := CASE WHEN public.has_role(auth.uid(), 'lecturer') AND NOT public.has_role(auth.uid(), 'student') THEN 'lecturer' ELSE 'student' END;
  ELSE
    NEW.verification_status := OLD.verification_status; NEW.verified_at := OLD.verified_at; NEW.account_type := OLD.account_type;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'admin') THEN 'admin'
    WHEN public.has_role(auth.uid(), 'rider') THEN 'rider'
    WHEN public.has_role(auth.uid(), 'student') THEN 'student'
    WHEN public.has_role(auth.uid(), 'lecturer') THEN 'lecturer'
    WHEN EXISTS (SELECT 1 FROM public.rider_applications WHERE user_id = auth.uid()) THEN 'applicant'
    ELSE NULL END
$function$;

CREATE OR REPLACE FUNCTION public.claim_lecturer_role()
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(uid::text));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid)
     AND NOT EXISTS (SELECT 1 FROM public.rider_applications WHERE user_id = uid)
     AND NOT EXISTS (SELECT 1 FROM public.verification_submissions WHERE student_id = uid) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'lecturer');
  END IF;
  RETURN public.get_my_role();
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_lecturer_role() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_lecturer_role() TO authenticated;

-- Students keep their existing flow; lecturers must use the lecturer submission.
CREATE OR REPLACE FUNCTION public.submit_verification(p_full_name text, p_matric text, p_faculty text, p_avatar_path text, p_id_card_path text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); cur public.student_profiles; sid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  IF public.has_role(uid, 'lecturer') AND NOT public.has_role(uid, 'student') THEN RAISE EXCEPTION 'Lecturer accounts must use lecturer verification'; END IF;
  IF length(trim(coalesce(p_full_name, ''))) = 0 THEN RAISE EXCEPTION 'Full name is required'; END IF;
  IF length(trim(coalesce(p_matric, ''))) = 0 THEN RAISE EXCEPTION 'Matric number is required'; END IF;
  IF length(trim(coalesce(p_faculty, ''))) = 0 THEN RAISE EXCEPTION 'Faculty is required'; END IF;
  IF coalesce(p_avatar_path, '') NOT LIKE uid::text || '/%' THEN RAISE EXCEPTION 'A profile photo is required'; END IF;
  IF coalesce(p_id_card_path, '') NOT LIKE uid::text || '/%' THEN RAISE EXCEPTION 'A FUTA student ID card image is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'profile-photos' AND name = p_avatar_path) THEN RAISE EXCEPTION 'Profile photo upload not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'student-id-cards' AND name = p_id_card_path) THEN RAISE EXCEPTION 'ID card upload not found'; END IF;
  SELECT * INTO cur FROM public.student_profiles WHERE id = uid FOR UPDATE;
  IF FOUND AND cur.verification_status = 'verified' THEN RAISE EXCEPTION 'Your account is already verified'; END IF;
  IF FOUND AND cur.verification_status = 'pending' AND cur.current_submission_id IS NOT NULL THEN RAISE EXCEPTION 'Your verification is already under review'; END IF;
  INSERT INTO public.verification_submissions (student_id, full_name, matric_number, faculty, avatar_path, id_card_path, account_type)
  VALUES (uid, trim(p_full_name), upper(trim(p_matric)), trim(p_faculty), p_avatar_path, p_id_card_path, 'student') RETURNING id INTO sid;
  INSERT INTO public.student_profiles (id, full_name, matric_number, faculty, avatar_path, verification_status, verified_at, rejection_reason, submitted_at, current_submission_id)
  VALUES (uid, trim(p_full_name), upper(trim(p_matric)), trim(p_faculty), p_avatar_path, 'pending', NULL, NULL, now(), sid)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, matric_number = EXCLUDED.matric_number,
    faculty = EXCLUDED.faculty, avatar_path = EXCLUDED.avatar_path, verification_status = 'pending',
    verified_at = NULL, rejection_reason = NULL, submitted_at = now(), current_submission_id = sid;
  RETURN sid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_lecturer_verification(p_full_name text, p_staff_id text, p_faculty text, p_department text, p_phone text, p_academic_title text, p_avatar_path text, p_id_card_path text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); cur public.student_profiles; sid uuid; ph text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  IF NOT public.has_role(uid, 'lecturer') OR public.has_role(uid, 'student') THEN RAISE EXCEPTION 'Only lecturer accounts can submit lecturer verification'; END IF;
  IF length(trim(coalesce(p_full_name, ''))) = 0 THEN RAISE EXCEPTION 'Full name is required'; END IF;
  IF length(trim(coalesce(p_staff_id, ''))) = 0 THEN RAISE EXCEPTION 'Staff ID is required'; END IF;
  IF length(trim(coalesce(p_faculty, ''))) = 0 THEN RAISE EXCEPTION 'Faculty/School is required'; END IF;
  IF length(trim(coalesce(p_department, ''))) = 0 THEN RAISE EXCEPTION 'Department is required'; END IF;
  IF length(ph) < 10 OR length(ph) > 15 THEN RAISE EXCEPTION 'Enter a valid phone number'; END IF;
  IF coalesce(p_avatar_path, '') NOT LIKE uid::text || '/%' THEN RAISE EXCEPTION 'A profile photo is required'; END IF;
  IF coalesce(p_id_card_path, '') NOT LIKE uid::text || '/%' THEN RAISE EXCEPTION 'A FUTA staff ID card image is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'profile-photos' AND name = p_avatar_path) THEN RAISE EXCEPTION 'Profile photo upload not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'student-id-cards' AND name = p_id_card_path) THEN RAISE EXCEPTION 'ID card upload not found'; END IF;
  SELECT * INTO cur FROM public.student_profiles WHERE id = uid FOR UPDATE;
  IF FOUND AND cur.verification_status = 'verified' THEN RAISE EXCEPTION 'Your account is already verified'; END IF;
  IF FOUND AND cur.verification_status = 'pending' AND cur.current_submission_id IS NOT NULL THEN RAISE EXCEPTION 'Your verification is already under review'; END IF;
  INSERT INTO public.verification_submissions (student_id, full_name, matric_number, faculty, department, phone, academic_title, avatar_path, id_card_path, account_type)
  VALUES (uid, trim(p_full_name), upper(trim(p_staff_id)), trim(p_faculty), trim(p_department), ph, nullif(trim(coalesce(p_academic_title,'')), ''), p_avatar_path, p_id_card_path, 'lecturer') RETURNING id INTO sid;
  INSERT INTO public.student_profiles (id, full_name, matric_number, faculty, department, phone, avatar_path, account_type, verification_status, verified_at, rejection_reason, submitted_at, current_submission_id)
  VALUES (uid, trim(p_full_name), upper(trim(p_staff_id)), trim(p_faculty), trim(p_department), ph, p_avatar_path, 'lecturer', 'pending', NULL, NULL, now(), sid)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, matric_number = EXCLUDED.matric_number, faculty = EXCLUDED.faculty,
    department = EXCLUDED.department, phone = EXCLUDED.phone, avatar_path = EXCLUDED.avatar_path, account_type = 'lecturer',
    verification_status = 'pending', verified_at = NULL, rejection_reason = NULL, submitted_at = now(), current_submission_id = sid;
  RETURN sid;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_lecturer_verification(text,text,text,text,text,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_lecturer_verification(text,text,text,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_ride(p_group_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g public.ride_groups; tid uuid; dest uuid;
BEGIN
  SELECT * INTO g FROM public.ride_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  IF g.status = 'confirmed' THEN RETURN jsonb_build_object('status', 'confirmed'); END IF;
  IF g.status <> 'ready' THEN RAISE EXCEPTION 'Your group is not ready yet. Every member must confirm the meeting point first.'; END IF;
  IF (SELECT count(*) FROM public.ride_group_members WHERE group_id = g.id) < 2 THEN RAISE EXCEPTION 'A ride needs at least two passengers'; END IF;
  IF public.group_passenger_count(g.id) > public.ride_capacity() THEN RAISE EXCEPTION 'This group has more passengers than a keke can carry'; END IF;
  IF EXISTS (SELECT 1 FROM public.ride_group_members m WHERE m.group_id = g.id AND NOT public.is_verified_student(m.student_id)) THEN
    RAISE EXCEPTION 'Every member must be a verified FUTA student or lecturer'; END IF;
  IF g.departure_time < now() - public.match_time_tolerance() THEN RAISE EXCEPTION 'The departure time for this group has passed'; END IF;
  IF g.meeting_point_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.locations WHERE id = g.meeting_point_location_id AND active) THEN
    RAISE EXCEPTION 'This meeting point is no longer available'; END IF;
  IF EXISTS (SELECT 1 FROM public.ride_group_members m JOIN public.ride_group_members m2 ON m2.student_id = m.student_id AND m2.group_id <> m.group_id
             JOIN public.ride_groups g2 ON g2.id = m2.group_id WHERE m.group_id = g.id AND g2.status IN ('forming','ready','confirmed')) THEN
    RAISE EXCEPTION 'A member of this group is already committed to another ride'; END IF;
  UPDATE public.ride_group_members SET ride_confirmed_at = coalesce(ride_confirmed_at, now()) WHERE group_id = g.id AND student_id = auth.uid();
  IF NOT EXISTS (SELECT 1 FROM public.ride_group_members WHERE group_id = g.id AND ride_confirmed_at IS NULL) THEN
    UPDATE public.ride_groups SET status = 'confirmed' WHERE id = g.id;
    SELECT r.destination_location_id INTO dest FROM public.ride_group_members m JOIN public.ride_requests r ON r.id = m.request_id WHERE m.group_id = g.id LIMIT 1;
    INSERT INTO public.trips (group_id, meeting_point_location_id, meeting_point_text, meeting_point_note, destination_location_id, destination_text, departure_time, passenger_count, member_count)
    VALUES (g.id, g.meeting_point_location_id, g.meeting_point_text, g.meeting_point_note, dest, g.destination_text, g.departure_time,
            public.group_passenger_count(g.id), (SELECT count(*) FROM public.ride_group_members WHERE group_id = g.id))
    ON CONFLICT (group_id) DO NOTHING RETURNING id INTO tid;
    IF tid IS NOT NULL THEN PERFORM public.log_trip_status(tid, NULL, 'confirmed', 'student', 'All members confirmed'); END IF;
    RETURN jsonb_build_object('status', 'confirmed');
  END IF;
  RETURN jsonb_build_object('status', 'ready');
END; $function$;