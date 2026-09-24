-- ===== Roles =====
-- Every existing account without a role was created through the student signup flow.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'student'::public.app_role FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id);

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'admin') THEN 'admin'
    WHEN public.has_role(auth.uid(), 'rider') THEN 'rider'
    WHEN public.has_role(auth.uid(), 'student') THEN 'student'
    ELSE NULL END
$$;

-- Self-service only for the default student role, and only when the account has no role at all.
CREATE OR REPLACE FUNCTION public.claim_student_role()
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(uid::text));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'student');
  END IF;
  RETURN public.get_my_role();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_student_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM anon;

-- ===== Structured meeting point =====
ALTER TABLE public.ride_groups
  ADD COLUMN meeting_point_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  ADD COLUMN meeting_point_note text,
  ADD COLUMN meeting_point_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.ride_groups ADD CONSTRAINT ride_groups_note_len CHECK (meeting_point_note IS NULL OR length(meeting_point_note) <= 140);
ALTER TABLE public.ride_group_members ADD COLUMN confirmed_version integer;
COMMENT ON COLUMN public.ride_group_members.meeting_point_agreed IS 'Mirror of confirmed_version = ride_groups.meeting_point_version; kept for compatibility';
COMMENT ON COLUMN public.ride_groups.meeting_point_text IS 'Display/historical snapshot; meeting_point_location_id is authoritative';

CREATE OR REPLACE FUNCTION public.group_organizer(_group_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT g.created_by FROM public.ride_groups g WHERE g.id = _group_id
       AND EXISTS (SELECT 1 FROM public.ride_group_members m WHERE m.group_id = g.id AND m.student_id = g.created_by)),
    (SELECT m.student_id FROM public.ride_group_members m WHERE m.group_id = _group_id ORDER BY m.joined_at, m.id LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION public.refresh_group_status(_group_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE g public.ride_groups;
BEGIN
  SELECT * INTO g FROM public.ride_groups WHERE id = _group_id;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.ride_group_members SET meeting_point_agreed = (confirmed_version IS NOT DISTINCT FROM g.meeting_point_version)
  WHERE group_id = _group_id AND meeting_point_agreed IS DISTINCT FROM (confirmed_version IS NOT DISTINCT FROM g.meeting_point_version);
  UPDATE public.ride_groups SET status = CASE
    WHEN (SELECT count(*) FROM public.ride_group_members m WHERE m.group_id = _group_id) >= 2
     AND (g.meeting_point_location_id IS NULL OR EXISTS (SELECT 1 FROM public.locations l WHERE l.id = g.meeting_point_location_id AND l.active))
     AND NOT EXISTS (SELECT 1 FROM public.ride_group_members m WHERE m.group_id = _group_id AND m.confirmed_version IS DISTINCT FROM g.meeting_point_version)
    THEN 'ready' ELSE 'forming' END
  WHERE id = _group_id AND status IN ('forming', 'ready');
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_meeting_point(p_group_id uuid, p_version integer DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE g public.ride_groups;
BEGIN
  SELECT * INTO g FROM public.ride_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  IF g.status NOT IN ('forming', 'ready') THEN RAISE EXCEPTION 'This group can no longer change'; END IF;
  IF p_version IS NOT NULL AND p_version <> g.meeting_point_version THEN
    RAISE EXCEPTION 'The meeting point has changed. Review the new meeting point and confirm again.';
  END IF;
  IF g.meeting_point_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.locations WHERE id = g.meeting_point_location_id AND active) THEN
    RAISE EXCEPTION 'This meeting point is no longer available. Your group needs to choose a new one.';
  END IF;
  UPDATE public.ride_group_members SET confirmed_version = g.meeting_point_version
  WHERE group_id = p_group_id AND student_id = auth.uid();
  PERFORM public.refresh_group_status(p_group_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.agree_meeting_point(p_group_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.confirm_meeting_point(p_group_id, NULL); END; $$;

CREATE OR REPLACE FUNCTION public.set_meeting_point(p_group_id uuid, p_location_id uuid, p_note text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE g public.ride_groups; loc public.locations; clean text;
BEGIN
  SELECT * INTO g FROM public.ride_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  IF public.group_organizer(p_group_id) <> auth.uid() THEN RAISE EXCEPTION 'Only the group organiser can change the meeting point'; END IF;
  IF g.status NOT IN ('forming', 'ready') THEN RAISE EXCEPTION 'This group can no longer change'; END IF;
  SELECT * INTO loc FROM public.locations WHERE id = p_location_id;
  IF NOT FOUND OR NOT loc.active THEN RAISE EXCEPTION 'Choose an active FUTAMOVE location'; END IF;
  clean := nullif(left(trim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]<>]', ' ', 'g')), 140), '');
  UPDATE public.ride_groups SET meeting_point_location_id = loc.id, meeting_point_text = loc.name,
    meeting_point_note = clean, meeting_point_version = meeting_point_version + 1
  WHERE id = p_group_id;
  -- Previous confirmations no longer apply; choosing the point counts as the organiser's confirmation.
  UPDATE public.ride_group_members SET confirmed_version = CASE WHEN student_id = auth.uid() THEN g.meeting_point_version + 1 ELSE NULL END
  WHERE group_id = p_group_id;
  PERFORM public.refresh_group_status(p_group_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.locations_deactivation_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE gid uuid;
BEGIN
  IF OLD.active AND NOT NEW.active THEN
    FOR gid IN SELECT id FROM public.ride_groups WHERE meeting_point_location_id = NEW.id AND status IN ('forming', 'ready') LOOP
      UPDATE public.ride_group_members SET confirmed_version = NULL WHERE group_id = gid;
      PERFORM public.refresh_group_status(gid);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER locations_deactivation_guard AFTER UPDATE OF active ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.locations_deactivation_guard();

CREATE OR REPLACE FUNCTION public.match_ride_request(p_request_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r public.ride_requests; cands uuid[]; gid uuid; g record; compatible int; mp_name text;
BEGIN
  SELECT * INTO r FROM public.ride_requests WHERE id = p_request_id AND student_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride request not found'; END IF;
  IF r.group_id IS NOT NULL THEN RETURN jsonb_build_object('group_id', r.group_id, 'compatible_count', NULL, 'eligible', true); END IF;
  IF NOT public.is_verified_student(r.student_id) THEN
    RETURN jsonb_build_object('group_id', NULL, 'compatible_count', 0, 'eligible', false);
  END IF;
  IF r.status <> 'searching' OR r.ride_type <> 'shared' OR r.departure_time < now() - public.match_time_tolerance() THEN
    RETURN jsonb_build_object('group_id', NULL, 'compatible_count', 0, 'eligible', true);
  END IF;

  FOR g IN
    SELECT grp.id FROM public.ride_groups grp
    WHERE grp.status IN ('forming', 'ready')
      AND public.group_passenger_count(grp.id) + r.party_size <= public.ride_capacity()
      AND NOT EXISTS (SELECT 1 FROM public.ride_group_members m WHERE m.group_id = grp.id AND m.student_id = r.student_id)
      AND EXISTS (SELECT 1 FROM public.ride_group_members m WHERE m.group_id = grp.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.ride_group_members m JOIN public.ride_requests o ON o.id = m.request_id
        WHERE m.group_id = grp.id AND (NOT public.requests_compatible(r, o) OR NOT public.is_verified_student(o.student_id)))
    ORDER BY grp.created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.ride_group_members (group_id, request_id, student_id) VALUES (g.id, r.id, r.student_id);
    PERFORM set_config('futamove.internal', '1', true);
    UPDATE public.ride_requests SET group_id = g.id WHERE id = r.id;
    PERFORM set_config('futamove.internal', '', true);
    PERFORM public.refresh_group_status(g.id);
    RETURN jsonb_build_object('group_id', g.id, 'compatible_count', NULL, 'eligible', true);
  END LOOP;

  cands := public.pick_compatible_requests(r.id, NULL, ARRAY[r.student_id], public.ride_capacity() - r.party_size);
  IF cardinality(cands) >= 1 THEN
    SELECT name INTO mp_name FROM public.locations WHERE id = r.origin_location_id;
    INSERT INTO public.ride_groups (destination_text, departure_time, meeting_point_text, meeting_point_location_id, created_by)
    VALUES (r.destination_text, r.departure_time, coalesce(mp_name, nullif(trim(r.meeting_point_text), ''), r.origin_text), r.origin_location_id, r.student_id)
    RETURNING id INTO gid;
    INSERT INTO public.ride_group_members (group_id, request_id, student_id) VALUES (gid, r.id, r.student_id);
    INSERT INTO public.ride_group_members (group_id, request_id, student_id)
    SELECT gid, o.id, o.student_id FROM public.ride_requests o WHERE o.id = ANY(cands) ORDER BY o.created_at;
    PERFORM set_config('futamove.internal', '1', true);
    UPDATE public.ride_requests SET group_id = gid WHERE id = r.id OR id = ANY(cands);
    PERFORM set_config('futamove.internal', '', true);
    PERFORM public.refresh_group_status(gid);
    RETURN jsonb_build_object('group_id', gid, 'compatible_count', cardinality(cands), 'eligible', true);
  END IF;

  SELECT count(DISTINCT o.student_id) INTO compatible FROM public.ride_requests o
  WHERE o.status = 'searching' AND o.group_id IS NULL AND o.student_id <> r.student_id
    AND o.departure_time > now() - public.match_time_tolerance()
    AND public.requests_compatible(r, o) AND public.is_verified_student(o.student_id);
  RETURN jsonb_build_object('group_id', NULL, 'compatible_count', compatible, 'eligible', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ride_group(p_group_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  SELECT jsonb_build_object(
    'id', g.id, 'destination_text', g.destination_text, 'departure_time', g.departure_time,
    'meeting_point_text', g.meeting_point_text, 'meeting_point_location_id', g.meeting_point_location_id,
    'meeting_point_active', coalesce(l.active, true), 'meeting_point_note', g.meeting_point_note,
    'meeting_point_version', g.meeting_point_version,
    'my_origin_text', (SELECT r.origin_text FROM public.ride_group_members m JOIN public.ride_requests r ON r.id = m.request_id WHERE m.group_id = g.id AND m.student_id = auth.uid()),
    'can_manage_meeting_point', public.group_organizer(g.id) = auth.uid(),
    'status', g.status,
    'capacity', public.ride_capacity(), 'passenger_count', public.group_passenger_count(g.id),
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'first_name', coalesce(nullif(split_part(trim(coalesce(p.full_name, u.raw_user_meta_data->>'full_name')), ' ', 1), ''), 'Student'),
        'is_me', m.student_id = auth.uid(),
        'is_organizer', m.student_id = public.group_organizer(g.id),
        'party_size', r.party_size,
        'meeting_point_agreed', m.confirmed_version IS NOT DISTINCT FROM g.meeting_point_version,
        'joined_at', m.joined_at) ORDER BY m.joined_at, m.id)
      FROM public.ride_group_members m
      JOIN public.ride_requests r ON r.id = m.request_id
      LEFT JOIN public.student_profiles p ON p.id = m.student_id
      LEFT JOIN auth.users u ON u.id = m.student_id
      WHERE m.group_id = g.id), '[]'::jsonb))
  INTO result FROM public.ride_groups g LEFT JOIN public.locations l ON l.id = g.meeting_point_location_id WHERE g.id = p_group_id;
  RETURN result;
END;
$function$;