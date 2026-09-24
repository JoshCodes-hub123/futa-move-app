-- Group statuses gain 'confirmed' (every member confirmed the ride, trip exists)
ALTER TABLE public.ride_groups DROP CONSTRAINT ride_groups_status_check;
ALTER TABLE public.ride_groups ADD CONSTRAINT ride_groups_status_check
  CHECK (status = ANY (ARRAY['forming','ready','confirmed','cancelled','completed']));
ALTER TABLE public.ride_group_members ADD COLUMN ride_confirmed_at timestamptz;

-- Operational trip: one per group, snapshots kept for history
CREATE TABLE public.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL UNIQUE REFERENCES public.ride_groups(id) ON DELETE RESTRICT,
  rider_id uuid,
  status text NOT NULL DEFAULT 'confirmed',
  meeting_point_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  meeting_point_text text NOT NULL,
  meeting_point_note text,
  destination_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  destination_text text NOT NULL,
  departure_time timestamptz NOT NULL,
  passenger_count int NOT NULL,
  member_count int NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz, accepted_at timestamptz, arriving_at timestamptz, arrived_at timestamptz,
  picked_up_at timestamptz, started_at timestamptz, completed_at timestamptz,
  cancelled_at timestamptz, cancelled_by uuid, cancelled_by_role text, cancel_reason text, cancelled_from_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_status_check CHECK (status = ANY (ARRAY['confirmed','assigned','accepted','arriving','picked_up','in_progress','completed',
    'cancelled_by_student','cancelled_by_rider','cancelled_by_admin','expired','no_show'])),
  CONSTRAINT trips_rider_required CHECK (status NOT IN ('assigned','accepted','arriving','picked_up','in_progress','completed') OR rider_id IS NOT NULL)
);
CREATE UNIQUE INDEX trips_one_active_per_rider ON public.trips(rider_id)
  WHERE status IN ('assigned','accepted','arriving','picked_up','in_progress');
CREATE INDEX trips_status_idx ON public.trips(status);
GRANT SELECT ON public.trips TO authenticated;
GRANT ALL ON public.trips TO service_role;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read trips" ON public.trips FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Riders read own trips" ON public.trips FOR SELECT TO authenticated USING (rider_id = auth.uid());
CREATE POLICY "Members read group trip" ON public.trips FOR SELECT TO authenticated USING (public.is_group_member(group_id, auth.uid()));
CREATE TRIGGER trips_set_updated_at BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.trip_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,
  actor_role text,
  rider_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_status_history_trip_idx ON public.trip_status_history(trip_id, created_at);
GRANT SELECT ON public.trip_status_history TO authenticated;
GRANT ALL ON public.trip_status_history TO service_role;
ALTER TABLE public.trip_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read trip history" ON public.trip_status_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Participants read trip history" ON public.trip_status_history FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND (t.rider_id = auth.uid() OR public.is_group_member(t.group_id, auth.uid()))));

-- Helpers
CREATE OR REPLACE FUNCTION public.trip_is_terminal(_s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _s IN ('completed','cancelled_by_student','cancelled_by_rider','cancelled_by_admin','expired','no_show') $$;

CREATE OR REPLACE FUNCTION public.rider_is_eligible(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'rider') AND EXISTS (SELECT 1 FROM public.rider_applications WHERE user_id = _uid AND status = 'approved') $$;

CREATE OR REPLACE FUNCTION public.rider_is_busy(_uid uuid, _except uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trips WHERE rider_id = _uid AND id IS DISTINCT FROM _except
    AND status IN ('assigned','accepted','arriving','picked_up','in_progress')) $$;

CREATE OR REPLACE FUNCTION public.student_in_active_group(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.ride_group_members m JOIN public.ride_groups g ON g.id = m.group_id
    WHERE m.student_id = _uid AND g.status IN ('forming','ready','confirmed')) $$;

CREATE OR REPLACE FUNCTION public.log_trip_status(_trip uuid, _from text, _to text, _role text, _reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.trip_status_history (trip_id, from_status, to_status, actor_id, actor_role, rider_id, reason)
  SELECT _trip, _from, _to, auth.uid(), _role, t.rider_id, nullif(left(btrim(coalesce(_reason,'')), 500), '') FROM public.trips t WHERE t.id = _trip $$;
REVOKE EXECUTE ON FUNCTION public.log_trip_status(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- Membership changes in a forming/ready group invalidate ride confirmations
CREATE OR REPLACE FUNCTION public.ride_members_reset_confirmations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid := coalesce(NEW.group_id, OLD.group_id);
BEGIN
  UPDATE public.ride_group_members SET ride_confirmed_at = NULL
  WHERE group_id = gid AND ride_confirmed_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.ride_groups g WHERE g.id = gid AND g.status IN ('forming','ready'));
  RETURN NULL;
END; $$;
CREATE TRIGGER ride_members_reset_confirmations AFTER INSERT OR DELETE ON public.ride_group_members
  FOR EACH ROW EXECUTE FUNCTION public.ride_members_reset_confirmations();

CREATE OR REPLACE FUNCTION public.refresh_group_status(_group_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  -- Ride confirmations only count while the group is ready
  UPDATE public.ride_group_members SET ride_confirmed_at = NULL
  WHERE group_id = _group_id AND ride_confirmed_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.ride_groups WHERE id = _group_id AND status = 'forming');
END;
$function$;

-- Student confirms the ride; last confirmation creates the trip
CREATE OR REPLACE FUNCTION public.confirm_ride(p_group_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.ride_groups; tid uuid; dest uuid;
BEGIN
  SELECT * INTO g FROM public.ride_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  IF g.status = 'confirmed' THEN RETURN jsonb_build_object('status', 'confirmed'); END IF;
  IF g.status <> 'ready' THEN RAISE EXCEPTION 'Your group is not ready yet. Every member must confirm the meeting point first.'; END IF;
  IF (SELECT count(*) FROM public.ride_group_members WHERE group_id = g.id) < 2 THEN RAISE EXCEPTION 'A ride needs at least two passengers'; END IF;
  IF public.group_passenger_count(g.id) > public.ride_capacity() THEN RAISE EXCEPTION 'This group has more passengers than a keke can carry'; END IF;
  IF EXISTS (SELECT 1 FROM public.ride_group_members m WHERE m.group_id = g.id AND NOT public.is_verified_student(m.student_id)) THEN
    RAISE EXCEPTION 'Every member must be a verified FUTA student'; END IF;
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
END; $$;

-- Student cancellation / leaving, now aware of confirmed trips
CREATE OR REPLACE FUNCTION public.release_request_from_group(_request_id uuid, _group_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE remaining int; gstatus text; t public.trips;
BEGIN
  SELECT status INTO gstatus FROM public.ride_groups WHERE id = _group_id FOR UPDATE;
  IF gstatus = 'completed' THEN RAISE EXCEPTION 'Completed rides cannot be cancelled'; END IF;
  IF gstatus = 'confirmed' THEN
    SELECT * INTO t FROM public.trips WHERE group_id = _group_id FOR UPDATE;
    IF FOUND AND t.status IN ('arriving','picked_up','in_progress') THEN
      RAISE EXCEPTION 'Your rider is already on the way. Contact FUTAMOVE support to cancel.';
    END IF;
  END IF;
  DELETE FROM public.ride_group_members WHERE request_id = _request_id AND group_id = _group_id;
  SELECT count(*) INTO remaining FROM public.ride_group_members WHERE group_id = _group_id;
  IF remaining < 2 THEN
    PERFORM set_config('futamove.internal', '1', true);
    UPDATE public.ride_requests SET group_id = NULL WHERE group_id = _group_id AND id <> _request_id;
    DELETE FROM public.ride_group_members WHERE group_id = _group_id;
    UPDATE public.ride_groups SET status = 'cancelled' WHERE id = _group_id;
    IF t.id IS NOT NULL AND NOT public.trip_is_terminal(t.status) THEN
      UPDATE public.trips SET status = 'cancelled_by_student', cancelled_at = now(), cancelled_by = auth.uid(), cancelled_by_role = 'student',
        cancel_reason = 'Not enough passengers after a cancellation', cancelled_from_status = t.status WHERE id = t.id;
      PERFORM public.log_trip_status(t.id, t.status, 'cancelled_by_student', 'student', 'Not enough passengers after a cancellation');
    END IF;
  ELSIF t.id IS NOT NULL THEN
    UPDATE public.trips SET passenger_count = public.group_passenger_count(_group_id), member_count = remaining WHERE id = t.id;
    PERFORM public.log_trip_status(t.id, t.status, t.status, 'student', 'A passenger cancelled');
  ELSE
    PERFORM public.refresh_group_status(_group_id);
  END IF;
END;
$function$;

-- Busy students (already in an active group) are not matched again
CREATE OR REPLACE FUNCTION public.pick_compatible_requests(_ref uuid, _group_id uuid, _exclude uuid[], _seats integer)
 RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
      AND NOT public.student_in_active_group(o.student_id)
    ORDER BY o.created_at
  LOOP
    EXIT WHEN seats <= 0;
    CONTINUE WHEN c.party_size > seats OR c.student_id = r.student_id OR c.student_id = ANY(students);
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
$function$;

CREATE OR REPLACE FUNCTION public.match_ride_request(p_request_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.ride_requests; cands uuid[]; gid uuid; g record; compatible int; mp_name text;
BEGIN
  SELECT * INTO r FROM public.ride_requests WHERE id = p_request_id AND student_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride request not found'; END IF;
  IF r.group_id IS NOT NULL THEN RETURN jsonb_build_object('group_id', r.group_id, 'compatible_count', NULL, 'eligible', true); END IF;
  IF NOT public.is_verified_student(r.student_id) THEN
    RETURN jsonb_build_object('group_id', NULL, 'compatible_count', 0, 'eligible', false);
  END IF;
  IF public.student_in_active_group(r.student_id) THEN
    RETURN jsonb_build_object('group_id', NULL, 'compatible_count', 0, 'eligible', true, 'busy', true);
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
    AND public.requests_compatible(r, o) AND public.is_verified_student(o.student_id)
    AND NOT public.student_in_active_group(o.student_id);
  RETURN jsonb_build_object('group_id', NULL, 'compatible_count', compatible, 'eligible', true);
END;
$function$;

-- Group view now includes ride confirmation + trip
CREATE OR REPLACE FUNCTION public.get_ride_group(p_group_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
        'ride_confirmed', m.ride_confirmed_at IS NOT NULL,
        'joined_at', m.joined_at) ORDER BY m.joined_at, m.id)
      FROM public.ride_group_members m
      JOIN public.ride_requests r ON r.id = m.request_id
      LEFT JOIN public.student_profiles p ON p.id = m.student_id
      LEFT JOIN auth.users u ON u.id = m.student_id
      WHERE m.group_id = g.id), '[]'::jsonb),
    'trip', (SELECT jsonb_build_object('id', t.id, 'status', t.status, 'meeting_point_text', t.meeting_point_text,
        'assigned_at', t.assigned_at, 'accepted_at', t.accepted_at, 'arriving_at', t.arriving_at, 'picked_up_at', t.picked_up_at,
        'started_at', t.started_at, 'completed_at', t.completed_at, 'cancelled_at', t.cancelled_at, 'cancel_reason', t.cancel_reason,
        'rider', CASE WHEN t.rider_id IS NULL OR t.status = 'assigned' THEN NULL ELSE (
          SELECT jsonb_build_object('first_name', split_part(btrim(a.full_name), ' ', 1), 'vehicle', a.vehicle_description, 'plate', a.plate_number)
          FROM public.rider_applications a WHERE a.user_id = t.rider_id ORDER BY a.created_at DESC LIMIT 1) END)
      FROM public.trips t WHERE t.group_id = g.id))
  INTO result FROM public.ride_groups g LEFT JOIN public.locations l ON l.id = g.meeting_point_location_id WHERE g.id = p_group_id;
  RETURN result;
END;
$function$;

-- Rider: list confirmed trips waiting for a rider (no student personal data)
CREATE OR REPLACE FUNCTION public.rider_available_trips() RETURNS TABLE(id uuid, meeting_point_text text, meeting_point_note text, destination_text text,
  departure_time timestamptz, passenger_count int, member_count int, confirmed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rider_is_eligible(auth.uid()) THEN RAISE EXCEPTION 'Only approved riders can view available rides'; END IF;
  RETURN QUERY SELECT t.id, t.meeting_point_text, t.meeting_point_note, t.destination_text, t.departure_time, t.passenger_count, t.member_count, t.confirmed_at
  FROM public.trips t WHERE t.status = 'confirmed' AND t.rider_id IS NULL ORDER BY t.departure_time;
END; $$;

-- Rider takes an available trip (goes straight to accepted)
CREATE OR REPLACE FUNCTION public.rider_claim_trip(p_trip_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips; uid uuid := auth.uid();
BEGIN
  IF NOT public.rider_is_eligible(uid) THEN RAISE EXCEPTION 'Only approved riders can accept rides'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('rider-trip:' || uid::text));
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF t.status <> 'confirmed' OR t.rider_id IS NOT NULL THEN RAISE EXCEPTION 'This ride is no longer available'; END IF;
  IF public.rider_is_busy(uid) THEN RAISE EXCEPTION 'Finish your current ride before accepting another'; END IF;
  UPDATE public.trips SET rider_id = uid, status = 'accepted', assigned_at = now(), accepted_at = now() WHERE id = t.id;
  PERFORM public.log_trip_status(t.id, t.status, 'accepted', 'rider', 'Rider accepted an available ride');
END; $$;

-- Rider accepts or rejects an admin assignment
CREATE OR REPLACE FUNCTION public.rider_respond_assignment(p_trip_id uuid, p_accept boolean, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips; uid uuid := auth.uid();
BEGIN
  IF NOT public.rider_is_eligible(uid) THEN RAISE EXCEPTION 'Only approved riders can respond to assignments'; END IF;
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR t.rider_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'This ride is not assigned to you'; END IF;
  IF t.status <> 'assigned' THEN RAISE EXCEPTION 'This assignment can no longer be changed'; END IF;
  IF p_accept THEN
    UPDATE public.trips SET status = 'accepted', accepted_at = now() WHERE id = t.id;
    PERFORM public.log_trip_status(t.id, 'assigned', 'accepted', 'rider', NULL);
  ELSE
    PERFORM public.log_trip_status(t.id, 'assigned', 'confirmed', 'rider', coalesce(nullif(btrim(p_reason), ''), 'Rider rejected the assignment'));
    UPDATE public.trips SET status = 'confirmed', rider_id = NULL, assigned_at = NULL WHERE id = t.id;
  END IF;
END; $$;

-- Rider moves the trip forward one valid step
CREATE OR REPLACE FUNCTION public.rider_advance_trip(p_trip_id uuid, p_to text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips; uid uuid := auth.uid();
BEGIN
  IF NOT public.rider_is_eligible(uid) THEN RAISE EXCEPTION 'Only approved riders can update rides'; END IF;
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR t.rider_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'This ride is not assigned to you'; END IF;
  IF NOT ((t.status = 'accepted' AND p_to = 'arriving') OR (t.status = 'arriving' AND p_to = 'picked_up')
       OR (t.status = 'picked_up' AND p_to = 'in_progress') OR (t.status = 'in_progress' AND p_to = 'completed')) THEN
    RAISE EXCEPTION 'That step is not allowed right now';
  END IF;
  UPDATE public.trips SET status = p_to,
    arriving_at = CASE WHEN p_to = 'arriving' THEN now() ELSE arriving_at END,
    arrived_at = CASE WHEN p_to = 'picked_up' THEN now() ELSE arrived_at END,
    picked_up_at = CASE WHEN p_to = 'picked_up' THEN now() ELSE picked_up_at END,
    started_at = CASE WHEN p_to = 'in_progress' THEN now() ELSE started_at END,
    completed_at = CASE WHEN p_to = 'completed' THEN now() ELSE completed_at END
  WHERE id = t.id;
  IF p_to = 'completed' THEN UPDATE public.ride_groups SET status = 'completed' WHERE id = t.group_id; END IF;
  PERFORM public.log_trip_status(t.id, t.status, p_to, 'rider', NULL);
END; $$;

-- Rider withdraws after accepting (before pickup); trip needs another rider
CREATE OR REPLACE FUNCTION public.rider_withdraw_trip(p_trip_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips; uid uuid := auth.uid();
BEGIN
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR t.rider_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'This ride is not assigned to you'; END IF;
  IF t.status NOT IN ('accepted','arriving') THEN RAISE EXCEPTION 'You can only withdraw before picking up passengers'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Tell us why you are withdrawing'; END IF;
  PERFORM public.log_trip_status(t.id, t.status, 'confirmed', 'rider', 'Rider withdrew: ' || btrim(p_reason));
  UPDATE public.trips SET status = 'confirmed', rider_id = NULL, assigned_at = NULL, accepted_at = NULL, arriving_at = NULL WHERE id = t.id;
END; $$;

-- Admin assigns or reassigns a rider
CREATE OR REPLACE FUNCTION public.admin_assign_rider(p_trip_id uuid, p_rider_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF NOT public.rider_is_eligible(p_rider_id) THEN RAISE EXCEPTION 'This rider is not approved or is suspended'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('rider-trip:' || p_rider_id::text));
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF t.status NOT IN ('confirmed','assigned','accepted') THEN RAISE EXCEPTION 'Riders can only be assigned before they head to the meeting point'; END IF;
  IF t.rider_id = p_rider_id THEN RAISE EXCEPTION 'This rider is already on this ride'; END IF;
  IF public.rider_is_busy(p_rider_id, t.id) THEN RAISE EXCEPTION 'This rider already has an active ride'; END IF;
  UPDATE public.trips SET rider_id = p_rider_id, status = 'assigned', assigned_at = now(), accepted_at = NULL WHERE id = t.id;
  PERFORM public.log_trip_status(t.id, t.status, 'assigned', 'admin', CASE WHEN t.rider_id IS NULL THEN 'Rider assigned' ELSE 'Rider reassigned' END);
END; $$;

-- Admin cancels / resolves an active trip
CREATE OR REPLACE FUNCTION public.admin_cancel_trip(p_trip_id uuid, p_outcome text, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF p_outcome NOT IN ('cancelled_by_admin','no_show','expired') THEN RAISE EXCEPTION 'Unknown outcome'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF public.trip_is_terminal(t.status) THEN RAISE EXCEPTION 'This ride is already finished'; END IF;
  UPDATE public.trips SET status = p_outcome, cancelled_at = now(), cancelled_by = auth.uid(), cancelled_by_role = 'admin',
    cancel_reason = left(btrim(p_reason), 500), cancelled_from_status = t.status WHERE id = t.id;
  UPDATE public.ride_groups SET status = 'cancelled' WHERE id = t.group_id;
  PERFORM public.log_trip_status(t.id, t.status, p_outcome, 'admin', p_reason);
END; $$;

-- Admin: eligible riders with availability
CREATE OR REPLACE FUNCTION public.admin_list_eligible_riders() RETURNS TABLE(user_id uuid, full_name text, vehicle_description text, plate_number text, busy boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN QUERY SELECT a.user_id, a.full_name, a.vehicle_description, a.plate_number, public.rider_is_busy(a.user_id)
  FROM public.rider_applications a WHERE a.status = 'approved' AND public.has_role(a.user_id, 'rider') ORDER BY a.full_name;
END; $$;