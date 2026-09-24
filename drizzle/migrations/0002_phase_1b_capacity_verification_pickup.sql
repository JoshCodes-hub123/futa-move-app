-- ===== Central matching configuration (single source of truth) =====
CREATE OR REPLACE FUNCTION public.ride_capacity() RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 4 $$;
CREATE OR REPLACE FUNCTION public.match_time_tolerance() RETURNS interval LANGUAGE sql IMMUTABLE AS $$ SELECT interval '30 minutes' $$;
CREATE OR REPLACE FUNCTION public.pickup_radius_m() RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT 400::double precision $$;
CREATE OR REPLACE FUNCTION public.dropoff_radius_m() RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT 600::double precision $$;

-- ===== Verification source =====
CREATE TYPE public.student_verification_status AS ENUM ('pending', 'verified', 'rejected');
CREATE TABLE public.student_profiles (
  id uuid PRIMARY KEY,
  full_name text,
  matric_number text,
  faculty text,
  verification_status public.student_verification_status NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.student_profiles TO authenticated;
GRANT ALL ON public.student_profiles TO service_role;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students read own profile" ON public.student_profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Students create own profile" ON public.student_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Students update own profile" ON public.student_profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER student_profiles_set_updated_at BEFORE UPDATE ON public.student_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Students can never set their own verification status
CREATE OR REPLACE FUNCTION public.student_profiles_verification_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending'; NEW.verified_at := NULL;
  ELSE
    NEW.verification_status := OLD.verification_status; NEW.verified_at := OLD.verified_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER student_profiles_verification_guard BEFORE INSERT OR UPDATE ON public.student_profiles
  FOR EACH ROW EXECUTE FUNCTION public.student_profiles_verification_guard();

CREATE OR REPLACE FUNCTION public.is_verified_student(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.student_profiles WHERE id = _user_id AND verification_status = 'verified')
$$;

-- ===== Ride request: party size, ride type, structured points =====
ALTER TABLE public.ride_requests ADD COLUMN party_size integer NOT NULL DEFAULT 1;
ALTER TABLE public.ride_requests ADD CONSTRAINT ride_requests_party_size_check CHECK (party_size BETWEEN 1 AND 4);
ALTER TABLE public.ride_requests ADD COLUMN ride_type text NOT NULL DEFAULT 'shared';
ALTER TABLE public.ride_requests ADD CONSTRAINT ride_requests_ride_type_check CHECK (ride_type IN ('shared', 'private'));
ALTER TABLE public.ride_requests ADD COLUMN origin_point_id text;
ALTER TABLE public.ride_requests ADD COLUMN destination_point_id text;

-- ===== Group lifecycle =====
ALTER TABLE public.ride_groups DROP CONSTRAINT IF EXISTS ride_groups_status_check;
ALTER TABLE public.ride_groups ADD CONSTRAINT ride_groups_status_check CHECK (status IN ('forming', 'ready', 'cancelled', 'completed'));

-- ===== Compatibility helpers =====
CREATE OR REPLACE FUNCTION public.geo_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

CREATE OR REPLACE FUNCTION public.places_compatible(
  a_id text, a_text text, a_lat double precision, a_lng double precision,
  b_id text, b_text text, b_lat double precision, b_lng double precision, radius_m double precision)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN a_id IS NOT NULL AND b_id IS NOT NULL THEN a_id = b_id
    WHEN a_lat IS NOT NULL AND a_lng IS NOT NULL AND b_lat IS NOT NULL AND b_lng IS NOT NULL
      THEN public.geo_distance_m(a_lat, a_lng, b_lat, b_lng) <= radius_m
    ELSE length(public.normalize_place(a_text)) > 0
      AND public.normalize_place(a_text) = public.normalize_place(b_text)
      AND public.normalize_place(a_text) <> 'my current location'
  END
$$;

-- Conservative: exact normalized text only (no substring matching)
CREATE OR REPLACE FUNCTION public.destinations_compatible(_a text, _b text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT length(public.normalize_place(_a)) > 0 AND public.normalize_place(_a) = public.normalize_place(_b)
$$;

CREATE OR REPLACE FUNCTION public.requests_compatible(a public.ride_requests, b public.ride_requests)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT a.ride_type = 'shared' AND b.ride_type = 'shared'
    AND public.places_compatible(a.destination_point_id, a.destination_text, a.destination_latitude, a.destination_longitude,
                                 b.destination_point_id, b.destination_text, b.destination_latitude, b.destination_longitude, public.dropoff_radius_m())
    AND public.places_compatible(a.origin_point_id, a.origin_text, a.origin_latitude, a.origin_longitude,
                                 b.origin_point_id, b.origin_text, b.origin_latitude, b.origin_longitude, public.pickup_radius_m())
    AND abs(extract(epoch FROM (a.departure_time - b.departure_time))) <= extract(epoch FROM public.match_time_tolerance())
$$;

CREATE OR REPLACE FUNCTION public.group_passenger_count(_group_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(r.party_size), 0)::int FROM public.ride_group_members m
  JOIN public.ride_requests r ON r.id = m.request_id WHERE m.group_id = _group_id
$$;

-- ===== Capacity: sum of party_size, never above ride_capacity() =====
CREATE OR REPLACE FUNCTION public.enforce_group_max_size()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE incoming int; gstatus text;
BEGIN
  SELECT status INTO gstatus FROM public.ride_groups WHERE id = NEW.group_id FOR UPDATE;
  IF gstatus NOT IN ('forming', 'ready') THEN RAISE EXCEPTION 'This group is no longer accepting members'; END IF;
  SELECT party_size INTO incoming FROM public.ride_requests WHERE id = NEW.request_id;
  IF public.group_passenger_count(NEW.group_id) + coalesce(incoming, 1) > public.ride_capacity() THEN
    RAISE EXCEPTION 'A keke carries at most % passengers', public.ride_capacity();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_group_status(_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ride_groups g SET status = CASE
    WHEN (SELECT count(*) FROM public.ride_group_members m WHERE m.group_id = g.id) >= 2
     AND NOT EXISTS (SELECT 1 FROM public.ride_group_members m WHERE m.group_id = g.id AND NOT m.meeting_point_agreed)
    THEN 'ready' ELSE 'forming' END
  WHERE g.id = _group_id AND g.status IN ('forming', 'ready');
END;
$$;

-- Remove a request from its group; dissolve (status cancelled) only when fewer than 2 requests remain
CREATE OR REPLACE FUNCTION public.release_request_from_group(_request_id uuid, _group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining int;
BEGIN
  PERFORM 1 FROM public.ride_groups WHERE id = _group_id FOR UPDATE;
  DELETE FROM public.ride_group_members WHERE request_id = _request_id AND group_id = _group_id;
  SELECT count(*) INTO remaining FROM public.ride_group_members WHERE group_id = _group_id;
  IF remaining < 2 THEN
    PERFORM set_config('futamove.internal', '1', true);
    UPDATE public.ride_requests SET group_id = NULL WHERE group_id = _group_id AND id <> _request_id;
    DELETE FROM public.ride_group_members WHERE group_id = _group_id;
    UPDATE public.ride_groups SET status = 'cancelled' WHERE id = _group_id;
  ELSE
    PERFORM public.refresh_group_status(_group_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ride_requests_group_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND OLD.group_id IS NOT NULL THEN
    NEW.group_id := NULL;
    PERFORM public.release_request_from_group(OLD.id, OLD.group_id);
    RETURN NEW;
  END IF;
  IF NEW.group_id IS DISTINCT FROM OLD.group_id AND coalesce(current_setting('futamove.internal', true), '') <> '1' THEN
    RAISE EXCEPTION 'Group membership can only change through matching';
  END IF;
  IF OLD.group_id IS NOT NULL AND NEW.group_id IS NOT NULL AND (
       NEW.party_size <> OLD.party_size OR NEW.ride_type <> OLD.ride_type
    OR NEW.destination_text <> OLD.destination_text OR NEW.origin_text <> OLD.origin_text
    OR NEW.departure_time <> OLD.departure_time
    OR NEW.origin_point_id IS DISTINCT FROM OLD.origin_point_id
    OR NEW.destination_point_id IS DISTINCT FROM OLD.destination_point_id) THEN
    RAISE EXCEPTION 'Leave your group before changing this ride request';
  END IF;
  RETURN NEW;
END;
$$;

-- ===== Candidate selection (party-size aware, pairwise compatible, verified only) =====
DROP FUNCTION IF EXISTS public.pick_compatible_requests(uuid, uuid[], int);
CREATE OR REPLACE FUNCTION public.pick_compatible_requests(_ref uuid, _group_id uuid, _exclude uuid[], _seats int)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ride_requests; c public.ride_requests; picked uuid[] := '{}'; students uuid[] := coalesce(_exclude, '{}');
  seats int := _seats; locked uuid;
BEGIN
  SELECT * INTO r FROM public.ride_requests WHERE id = _ref;
  FOR c IN
    SELECT o.* FROM public.ride_requests o
    WHERE o.status = 'searching' AND o.group_id IS NULL AND o.id <> r.id AND o.party_size <= seats
      AND o.departure_time > now() - public.match_time_tolerance()
      AND public.requests_compatible(r, o)
      AND public.is_verified_student(o.student_id)
    ORDER BY o.created_at
  LOOP
    EXIT WHEN seats <= 0;
    CONTINUE WHEN c.party_size > seats OR c.student_id = r.student_id OR c.student_id = ANY(students);
    -- must be compatible with every request already picked and every existing group member
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.ride_requests p WHERE p.id = ANY(picked) AND NOT public.requests_compatible(p, c));
    CONTINUE WHEN _group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.ride_group_members m JOIN public.ride_requests p ON p.id = m.request_id
      WHERE m.group_id = _group_id AND NOT public.requests_compatible(p, c));
    SELECT id INTO locked FROM public.ride_requests WHERE id = c.id AND group_id IS NULL AND status = 'searching' FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN locked IS NULL;
    picked := picked || c.id; students := students || c.student_id; seats := seats - c.party_size; locked := NULL;
  END LOOP;
  RETURN picked;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_ride_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ride_requests; cands uuid[]; gid uuid; g record; compatible int;
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

  -- 1. Join an existing compatible group with enough seats
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

  -- 2. Form a new group with compatible searching requests that fit
  cands := public.pick_compatible_requests(r.id, NULL, ARRAY[r.student_id], public.ride_capacity() - r.party_size);
  IF cardinality(cands) >= 1 THEN
    INSERT INTO public.ride_groups (destination_text, departure_time, meeting_point_text, created_by)
    VALUES (r.destination_text, r.departure_time, coalesce(nullif(trim(r.meeting_point_text), ''), r.origin_text), r.student_id)
    RETURNING id INTO gid;
    INSERT INTO public.ride_group_members (group_id, request_id, student_id, meeting_point_agreed) VALUES (gid, r.id, r.student_id, true);
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
$$;

CREATE OR REPLACE FUNCTION public.add_group_member(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE seats int; ref uuid; students uuid[]; cands uuid[]; gstatus text;
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  SELECT status INTO gstatus FROM public.ride_groups WHERE id = p_group_id FOR UPDATE;
  IF gstatus NOT IN ('forming', 'ready') THEN RAISE EXCEPTION 'This group is no longer accepting members'; END IF;
  seats := public.ride_capacity() - public.group_passenger_count(p_group_id);
  IF seats <= 0 THEN RETURN jsonb_build_object('added', false, 'reason', 'full'); END IF;
  SELECT array_agg(student_id) INTO students FROM public.ride_group_members WHERE group_id = p_group_id;
  SELECT request_id INTO ref FROM public.ride_group_members WHERE group_id = p_group_id AND student_id = auth.uid();
  cands := public.pick_compatible_requests(ref, p_group_id, students, seats);
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

CREATE OR REPLACE FUNCTION public.leave_ride_group(p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE req uuid; gstatus text;
BEGIN
  SELECT request_id INTO req FROM public.ride_group_members WHERE group_id = p_group_id AND student_id = auth.uid();
  IF req IS NULL THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  SELECT status INTO gstatus FROM public.ride_groups WHERE id = p_group_id;
  IF gstatus NOT IN ('forming', 'ready') THEN RAISE EXCEPTION 'You can only leave a group before the ride is confirmed'; END IF;
  PERFORM public.release_request_from_group(req, p_group_id);
  PERFORM set_config('futamove.internal', '1', true);
  UPDATE public.ride_requests SET group_id = NULL WHERE id = req;
  PERFORM set_config('futamove.internal', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ride_group(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  SELECT jsonb_build_object(
    'id', g.id, 'destination_text', g.destination_text, 'departure_time', g.departure_time,
    'meeting_point_text', g.meeting_point_text, 'status', g.status,
    'capacity', public.ride_capacity(), 'passenger_count', public.group_passenger_count(g.id),
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'first_name', coalesce(nullif(split_part(trim(coalesce(p.full_name, u.raw_user_meta_data->>'full_name')), ' ', 1), ''), 'Student'),
        'is_me', m.student_id = auth.uid(),
        'is_organizer', m.student_id = g.created_by,
        'party_size', r.party_size,
        'meeting_point_agreed', m.meeting_point_agreed,
        'joined_at', m.joined_at) ORDER BY m.joined_at, m.id)
      FROM public.ride_group_members m
      JOIN public.ride_requests r ON r.id = m.request_id
      LEFT JOIN public.student_profiles p ON p.id = m.student_id
      LEFT JOIN auth.users u ON u.id = m.student_id
      WHERE m.group_id = g.id), '[]'::jsonb))
  INTO result FROM public.ride_groups g WHERE g.id = p_group_id;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pick_compatible_requests(uuid, uuid, uuid[], int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_request_from_group(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.group_passenger_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_group_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leave_ride_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_ride_group(uuid) TO authenticated;