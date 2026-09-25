CREATE OR REPLACE FUNCTION public.claim_lecturer_role()
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(uid::text));
  IF public.has_role(uid, 'lecturer') THEN RETURN public.get_my_role(); END IF;
  -- Only a brand-new account (no role, or an unused student role) may become a lecturer.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role <> 'student')
     OR EXISTS (SELECT 1 FROM public.rider_applications WHERE user_id = uid)
     OR EXISTS (SELECT 1 FROM public.verification_submissions WHERE student_id = uid)
     OR EXISTS (SELECT 1 FROM public.ride_requests WHERE student_id = uid) THEN
    RAISE EXCEPTION 'This account is already set up. Use a new account to register as a lecturer.';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = uid AND role = 'student';
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'lecturer');
  RETURN public.get_my_role();
END;
$function$;