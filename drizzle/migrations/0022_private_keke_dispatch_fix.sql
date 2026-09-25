CREATE OR REPLACE FUNCTION public.start_private_ride(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ride_requests; gid uuid; tid uuid;
BEGIN
  SELECT * INTO r FROM public.ride_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.student_id <> auth.uid() THEN RAISE EXCEPTION 'Ride request not found'; END IF;
  IF r.ride_type <> 'private' THEN RAISE EXCEPTION 'Only Private Keke requests can use this'; END IF;
  IF r.group_id IS NOT NULL THEN RETURN jsonb_build_object('started', true, 'group_id', r.group_id); END IF;
  IF r.status <> 'searching' THEN RAISE EXCEPTION 'This request is no longer active'; END IF;
  IF NOT public.is_verified_student(r.student_id) THEN
    RETURN jsonb_build_object('started', false, 'reason', 'not_verified'); END IF;
  IF r.departure_time < now() - public.match_time_tolerance() THEN
    RETURN jsonb_build_object('started', false, 'reason', 'departure_passed'); END IF;
  IF r.party_size > public.ride_capacity() THEN RAISE EXCEPTION 'Your party is larger than a keke can carry'; END IF;
  IF r.origin_location_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.locations WHERE id = r.origin_location_id AND active) THEN
    RETURN jsonb_build_object('started', false, 'reason', 'pickup_unavailable'); END IF;
  IF public.student_in_active_group(r.student_id) THEN
    RETURN jsonb_build_object('started', false, 'reason', 'already_in_ride'); END IF;

  -- Inserted as forming so the member-size trigger accepts the single booking, then confirmed immediately in the same transaction.
  INSERT INTO public.ride_groups (destination_text, departure_time, meeting_point_text, meeting_point_location_id, created_by, status, is_private, meeting_point_version)
  VALUES (r.destination_text, r.departure_time, r.origin_text, r.origin_location_id, r.student_id, 'forming', true, 1)
  RETURNING id INTO gid;
  INSERT INTO public.ride_group_members (group_id, request_id, student_id, meeting_point_agreed, confirmed_version, ride_confirmed_at)
  VALUES (gid, r.id, r.student_id, true, 1, now());
  UPDATE public.ride_groups SET status = 'confirmed' WHERE id = gid;
  UPDATE public.ride_group_members SET ride_confirmed_at = coalesce(ride_confirmed_at, now()), confirmed_version = 1 WHERE group_id = gid;
  PERFORM set_config('futamove.internal', '1', true);
  UPDATE public.ride_requests SET group_id = gid WHERE id = r.id;
  PERFORM set_config('futamove.internal', '', true);
  INSERT INTO public.trips (group_id, meeting_point_location_id, meeting_point_text, destination_location_id, destination_text, departure_time, passenger_count, member_count)
  VALUES (gid, r.origin_location_id, r.origin_text, r.destination_location_id, r.destination_text, r.departure_time, r.party_size, 1)
  RETURNING id INTO tid;
  PERFORM public.log_trip_status(tid, NULL, 'confirmed', 'student', 'Private Keke request');
  RETURN jsonb_build_object('started', true, 'group_id', gid);
END; $$;