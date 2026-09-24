ALTER TABLE public.ride_requests ADD COLUMN meeting_point_text text;
ALTER TABLE public.ride_requests ADD COLUMN group_id uuid;

CREATE TABLE public.ride_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_text text NOT NULL,
  departure_time timestamptz NOT NULL,
  meeting_point_text text NOT NULL,
  created_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'forming' CHECK (status IN ('forming','ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ride_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.ride_groups(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE REFERENCES public.ride_requests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  meeting_point_agreed boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, student_id)
);
CREATE INDEX ride_group_members_group_idx ON public.ride_group_members(group_id);
CREATE INDEX ride_requests_searching_idx ON public.ride_requests(status, departure_time) WHERE group_id IS NULL;

ALTER TABLE public.ride_requests
  ADD CONSTRAINT ride_requests_group_fk FOREIGN KEY (group_id) REFERENCES public.ride_groups(id) ON DELETE SET NULL;

GRANT SELECT ON public.ride_groups TO authenticated;
GRANT SELECT ON public.ride_group_members TO authenticated;
GRANT ALL ON public.ride_groups TO service_role;
GRANT ALL ON public.ride_group_members TO service_role;
ALTER TABLE public.ride_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_group_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.ride_group_members WHERE group_id = _group_id AND student_id = _user_id)
$$;

CREATE POLICY "Members read their groups" ON public.ride_groups FOR SELECT TO authenticated
  USING (public.is_group_member(id, auth.uid()));
CREATE POLICY "Members read group membership" ON public.ride_group_members FOR SELECT TO authenticated
  USING (public.is_group_member(group_id, auth.uid()));

CREATE TRIGGER ride_groups_set_updated_at BEFORE UPDATE ON public.ride_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Hard cap: never more than 5 members
CREATE OR REPLACE FUNCTION public.enforce_group_max_size()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.ride_group_members WHERE group_id = NEW.group_id) >= 5 THEN
    RAISE EXCEPTION 'This group already has 5 students';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ride_group_members_max_size BEFORE INSERT ON public.ride_group_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_max_size();

CREATE OR REPLACE FUNCTION public.normalize_place(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(trim(coalesce(_t,'')), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.destinations_compatible(_a text, _b text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT length(public.normalize_place(_a)) > 0 AND length(public.normalize_place(_b)) > 0 AND (
    public.normalize_place(_a) = public.normalize_place(_b)
    OR public.normalize_place(_a) LIKE '%' || public.normalize_place(_b) || '%'
    OR public.normalize_place(_b) LIKE '%' || public.normalize_place(_a) || '%')
$$;

CREATE OR REPLACE FUNCTION public.refresh_group_status(_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ride_groups g SET status = CASE
    WHEN (SELECT count(*) FROM public.ride_group_members m WHERE m.group_id = g.id) >= 3
     AND NOT EXISTS (SELECT 1 FROM public.ride_group_members m WHERE m.group_id = g.id AND NOT m.meeting_point_agreed)
    THEN 'ready' ELSE 'forming' END
  WHERE g.id = _group_id;
END;
$$;

-- Protect group_id from client writes; handle leaving a group on cancellation
CREATE OR REPLACE FUNCTION public.ride_requests_group_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining int; gid uuid;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND OLD.group_id IS NOT NULL THEN
    gid := OLD.group_id;
    NEW.group_id := NULL;
    DELETE FROM public.ride_group_members WHERE request_id = NEW.id;
    SELECT count(*) INTO remaining FROM public.ride_group_members WHERE group_id = gid;
    IF remaining < 3 THEN
      PERFORM set_config('futamove.internal', '1', true);
      UPDATE public.ride_requests SET group_id = NULL WHERE group_id = gid AND id <> NEW.id;
      DELETE FROM public.ride_groups WHERE id = gid;
    ELSE
      PERFORM public.refresh_group_status(gid);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.group_id IS DISTINCT FROM OLD.group_id AND coalesce(current_setting('futamove.internal', true), '') <> '1' THEN
    RAISE EXCEPTION 'Group membership can only change through matching';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ride_requests_group_guard BEFORE UPDATE ON public.ride_requests
  FOR EACH ROW EXECUTE FUNCTION public.ride_requests_group_guard();

CREATE OR REPLACE FUNCTION public.ride_requests_insert_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.group_id := NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ride_requests_insert_guard BEFORE INSERT ON public.ride_requests
  FOR EACH ROW EXECUTE FUNCTION public.ride_requests_insert_guard();

-- Pick up to _limit compatible, unassigned searching requests from distinct other students
CREATE OR REPLACE FUNCTION public.pick_compatible_requests(_ref uuid, _exclude uuid[], _limit int)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ride_requests; c record; picked uuid[] := '{}'; students uuid[] := coalesce(_exclude, '{}'); locked uuid;
BEGIN
  SELECT * INTO r FROM public.ride_requests WHERE id = _ref;
  FOR c IN
    SELECT o.id, o.student_id FROM public.ride_requests o
    WHERE o.status = 'searching' AND o.group_id IS NULL AND o.id <> r.id
      AND public.destinations_compatible(o.destination_text, r.destination_text)
      AND abs(extract(epoch FROM (o.departure_time - r.departure_time))) <= 1800
      AND o.departure_time > now() - interval '30 minutes'
    ORDER BY o.created_at
  LOOP
    EXIT WHEN cardinality(picked) >= _limit;
    CONTINUE WHEN c.student_id = r.student_id OR c.student_id = ANY(students);
    SELECT id INTO locked FROM public.ride_requests WHERE id = c.id AND group_id IS NULL AND status = 'searching' FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN locked IS NULL;
    picked := picked || c.id;
    students := students || c.student_id;
    locked := NULL;
  END LOOP;
  RETURN picked;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_ride_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ride_requests; cands uuid[]; gid uuid; compatible int;
BEGIN
  SELECT * INTO r FROM public.ride_requests WHERE id = p_request_id AND student_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride request not found'; END IF;
  IF r.group_id IS NOT NULL THEN RETURN jsonb_build_object('group_id', r.group_id, 'compatible_count', NULL); END IF;
  IF r.status <> 'searching' THEN RETURN jsonb_build_object('group_id', NULL, 'compatible_count', 0); END IF;

  cands := public.pick_compatible_requests(r.id, ARRAY[r.student_id], 2);
  IF cardinality(cands) >= 2 THEN
    INSERT INTO public.ride_groups (destination_text, departure_time, meeting_point_text, created_by)
    VALUES (r.destination_text, r.departure_time, coalesce(nullif(trim(r.meeting_point_text), ''), r.origin_text), r.student_id)
    RETURNING id INTO gid;
    INSERT INTO public.ride_group_members (group_id, request_id, student_id, meeting_point_agreed)
    VALUES (gid, r.id, r.student_id, true);
    INSERT INTO public.ride_group_members (group_id, request_id, student_id)
    SELECT gid, o.id, o.student_id FROM public.ride_requests o WHERE o.id = ANY(cands);
    PERFORM set_config('futamove.internal', '1', true);
    UPDATE public.ride_requests SET group_id = gid WHERE id = r.id OR id = ANY(cands);
    PERFORM set_config('futamove.internal', '', true);
    PERFORM public.refresh_group_status(gid);
    RETURN jsonb_build_object('group_id', gid, 'compatible_count', 2);
  END IF;

  SELECT count(DISTINCT o.student_id) INTO compatible FROM public.ride_requests o
  WHERE o.status = 'searching' AND o.group_id IS NULL AND o.student_id <> r.student_id
    AND public.destinations_compatible(o.destination_text, r.destination_text)
    AND abs(extract(epoch FROM (o.departure_time - r.departure_time))) <= 1800
    AND o.departure_time > now() - interval '30 minutes';
  RETURN jsonb_build_object('group_id', NULL, 'compatible_count', compatible);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_group_member(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE size int; ref uuid; students uuid[]; cands uuid[];
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  PERFORM 1 FROM public.ride_groups WHERE id = p_group_id FOR UPDATE;
  SELECT count(*), array_agg(student_id) INTO size, students FROM public.ride_group_members WHERE group_id = p_group_id;
  IF size >= 5 THEN RETURN jsonb_build_object('added', false, 'reason', 'full'); END IF;
  SELECT request_id INTO ref FROM public.ride_group_members WHERE group_id = p_group_id AND student_id = auth.uid();
  cands := public.pick_compatible_requests(ref, students, 1);
  IF cardinality(cands) = 0 THEN RETURN jsonb_build_object('added', false, 'reason', 'none_available'); END IF;
  INSERT INTO public.ride_group_members (group_id, request_id, student_id)
  SELECT p_group_id, o.id, o.student_id FROM public.ride_requests o WHERE o.id = cands[1];
  PERFORM set_config('futamove.internal', '1', true);
  UPDATE public.ride_requests SET group_id = p_group_id WHERE id = cands[1];
  PERFORM set_config('futamove.internal', '', true);
  PERFORM public.refresh_group_status(p_group_id);
  RETURN jsonb_build_object('added', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.agree_meeting_point(p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ride_group_members SET meeting_point_agreed = true
  WHERE group_id = p_group_id AND student_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  PERFORM public.refresh_group_status(p_group_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ride_group(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  SELECT jsonb_build_object(
    'id', g.id, 'destination_text', g.destination_text, 'departure_time', g.departure_time,
    'meeting_point_text', g.meeting_point_text, 'status', g.status, 'max_size', 5,
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'first_name', coalesce(nullif(split_part(trim(u.raw_user_meta_data->>'full_name'), ' ', 1), ''), 'Student'),
        'is_me', m.student_id = auth.uid(),
        'is_organizer', m.student_id = g.created_by,
        'meeting_point_agreed', m.meeting_point_agreed,
        'joined_at', m.joined_at) ORDER BY m.joined_at, m.id)
      FROM public.ride_group_members m LEFT JOIN auth.users u ON u.id = m.student_id
      WHERE m.group_id = g.id), '[]'::jsonb))
  INTO result FROM public.ride_groups g WHERE g.id = p_group_id;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pick_compatible_requests(uuid, uuid[], int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_group_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_ride_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_group_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.agree_meeting_point(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ride_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_ride_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_group_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agree_meeting_point(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ride_group(uuid) TO authenticated;