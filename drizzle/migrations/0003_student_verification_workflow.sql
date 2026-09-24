-- ===== Roles =====
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ===== Profile fields =====
ALTER TABLE public.student_profiles ADD COLUMN avatar_path text;
ALTER TABLE public.student_profiles ADD COLUMN rejection_reason text;
ALTER TABLE public.student_profiles ADD COLUMN submitted_at timestamptz;
ALTER TABLE public.student_profiles ADD COLUMN current_submission_id uuid;

-- Students no longer write profiles directly: all writes go through submit_verification (server-controlled)
REVOKE INSERT, UPDATE ON public.student_profiles FROM authenticated;
CREATE POLICY "Admins read all profiles" ON public.student_profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ===== Submission history (audit trail; never overwritten) =====
CREATE TABLE public.verification_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  full_name text NOT NULL,
  matric_number text NOT NULL,
  faculty text NOT NULL,
  avatar_path text NOT NULL,
  id_card_path text NOT NULL,
  status public.student_verification_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_submissions_student_idx ON public.verification_submissions (student_id, created_at DESC);
CREATE INDEX verification_submissions_status_idx ON public.verification_submissions (status, created_at);
GRANT SELECT ON public.verification_submissions TO authenticated;
GRANT ALL ON public.verification_submissions TO service_role;
ALTER TABLE public.verification_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read own submissions" ON public.verification_submissions FOR SELECT TO authenticated USING (auth.uid() = student_id);
CREATE POLICY "Admins read all submissions" ON public.verification_submissions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.student_profiles ADD CONSTRAINT student_profiles_current_submission_fk
  FOREIGN KEY (current_submission_id) REFERENCES public.verification_submissions(id);

-- ===== Student submits / resubmits =====
CREATE OR REPLACE FUNCTION public.submit_verification(p_full_name text, p_matric text, p_faculty text, p_avatar_path text, p_id_card_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cur public.student_profiles; sid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  IF length(trim(coalesce(p_full_name, ''))) = 0 THEN RAISE EXCEPTION 'Full name is required'; END IF;
  IF length(trim(coalesce(p_matric, ''))) = 0 THEN RAISE EXCEPTION 'Matric number is required'; END IF;
  IF length(trim(coalesce(p_faculty, ''))) = 0 THEN RAISE EXCEPTION 'Faculty is required'; END IF;
  IF coalesce(p_avatar_path, '') NOT LIKE uid::text || '/%' THEN RAISE EXCEPTION 'A profile photo is required'; END IF;
  IF coalesce(p_id_card_path, '') NOT LIKE uid::text || '/%' THEN RAISE EXCEPTION 'A FUTA student ID card image is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'profile-photos' AND name = p_avatar_path) THEN RAISE EXCEPTION 'Profile photo upload not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'student-id-cards' AND name = p_id_card_path) THEN RAISE EXCEPTION 'ID card upload not found'; END IF;

  SELECT * INTO cur FROM public.student_profiles WHERE id = uid FOR UPDATE;
  IF FOUND AND cur.verification_status = 'verified' THEN RAISE EXCEPTION 'Your account is already verified'; END IF;
  IF FOUND AND cur.verification_status = 'pending' AND cur.current_submission_id IS NOT NULL THEN
    RAISE EXCEPTION 'Your verification is already under review';
  END IF;

  INSERT INTO public.verification_submissions (student_id, full_name, matric_number, faculty, avatar_path, id_card_path)
  VALUES (uid, trim(p_full_name), upper(trim(p_matric)), trim(p_faculty), p_avatar_path, p_id_card_path)
  RETURNING id INTO sid;

  INSERT INTO public.student_profiles (id, full_name, matric_number, faculty, avatar_path, verification_status, verified_at, rejection_reason, submitted_at, current_submission_id)
  VALUES (uid, trim(p_full_name), upper(trim(p_matric)), trim(p_faculty), p_avatar_path, 'pending', NULL, NULL, now(), sid)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, matric_number = EXCLUDED.matric_number,
    faculty = EXCLUDED.faculty, avatar_path = EXCLUDED.avatar_path, verification_status = 'pending',
    verified_at = NULL, rejection_reason = NULL, submitted_at = now(), current_submission_id = sid;
  RETURN sid;
END;
$$;

-- ===== Admin approves / rejects =====
CREATE OR REPLACE FUNCTION public.review_verification(p_submission_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.verification_submissions;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only administrators can review verification'; END IF;
  SELECT * INTO s FROM public.verification_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submission not found'; END IF;
  IF s.status <> 'pending' THEN RAISE EXCEPTION 'This submission has already been reviewed'; END IF;
  IF s.student_id = auth.uid() THEN RAISE EXCEPTION 'You cannot review your own verification'; END IF;
  IF NOT p_approve AND length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;

  UPDATE public.verification_submissions SET status = CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END::public.student_verification_status,
    rejection_reason = CASE WHEN p_approve THEN NULL ELSE trim(p_reason) END, reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = s.id;

  UPDATE public.student_profiles SET
    verification_status = CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END::public.student_verification_status,
    verified_at = CASE WHEN p_approve THEN now() ELSE NULL END,
    rejection_reason = CASE WHEN p_approve THEN NULL ELSE trim(p_reason) END,
    current_submission_id = CASE WHEN p_approve THEN s.id ELSE NULL END
  WHERE id = s.student_id AND current_submission_id = s.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_verification(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_verification(text, text, text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.review_verification(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_verification(uuid, boolean, text) TO authenticated;

-- ===== Storage policies: owner folder = auth.uid(); admins read; never public =====
CREATE POLICY "Students upload own profile photo" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Students read own profile photo" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Admins read profile photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-photos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Students upload own ID card" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'student-id-cards' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Students read own ID card" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'student-id-cards' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Admins read ID cards" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'student-id-cards' AND public.has_role(auth.uid(), 'admin'));