CREATE OR REPLACE FUNCTION public.student_available_riders(p_trip_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t trips; uid uuid := auth.uid();
BEGIN
  SELECT * INTO t FROM trips WHERE id = p_trip_id;
  IF NOT FOUND OR NOT is_group_member(t.group_id, uid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF t.status <> 'confirmed' OR t.rider_id IS NOT NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'assigned', 'riders', '[]'::jsonb); END IF;
  IF EXISTS (SELECT 1 FROM ride_offers WHERE trip_id = t.id AND response = 'pending') THEN
    RETURN jsonb_build_object('available', false, 'reason', 'offer_pending', 'riders', '[]'::jsonb); END IF;
  RETURN jsonb_build_object('available', true, 'reason', null, 'riders', coalesce((
    SELECT jsonb_agg(r ORDER BY ord) FROM (
      SELECT row_number() OVER () AS ord, jsonb_build_object(
        'rider_id', c.rider_id,
        'first_name', split_part(coalesce(a.full_name,'Rider'),' ',1),
        'avatar_path', a.avatar_path, 'vehicle', a.vehicle_description, 'plate', a.plate_number,
        'completed_rides', (SELECT count(*) FROM trips x WHERE x.rider_id = c.rider_id AND x.status = 'completed'),
        'rating_avg', (SELECT round(avg(stars)::numeric,1) FROM rider_ratings WHERE rider_id = c.rider_id),
        'rating_count', (SELECT count(*) FROM rider_ratings WHERE rider_id = c.rider_id),
        'distance_km', CASE WHEN (c.breakdown->>'distance_m') IS NULL THEN NULL ELSE round(((c.breakdown->>'distance_m')::numeric/1000.0), 1) END
      ) AS r
      FROM (SELECT * FROM dispatch_candidates(t.id) LIMIT 5) c
      JOIN LATERAL (SELECT * FROM rider_applications WHERE user_id = c.rider_id AND status = 'approved' ORDER BY created_at DESC LIMIT 1) a ON true
    ) s), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.student_request_rider(p_trip_id uuid, p_rider_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t trips; uid uuid := auth.uid(); c record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rider-trip:' || p_rider_id::text));
  SELECT * INTO t FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR NOT is_group_member(t.group_id, uid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF t.status <> 'confirmed' OR t.rider_id IS NOT NULL THEN RAISE EXCEPTION 'A rider has already been found for this ride'; END IF;
  IF EXISTS (SELECT 1 FROM ride_offers WHERE trip_id = t.id AND response = 'pending') THEN RAISE EXCEPTION 'This ride is currently being offered to a rider. Please wait a moment.'; END IF;
  SELECT * INTO c FROM dispatch_candidates(t.id) d WHERE d.rider_id = p_rider_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'This rider is no longer available. Pick another rider or keep waiting.'; END IF;
  UPDATE trips SET rider_id = p_rider_id, status = 'assigned', assigned_at = now(), accepted_at = NULL WHERE id = t.id;
  PERFORM log_trip_status(t.id, 'confirmed', 'assigned', 'student', 'Passenger chose an available rider');
  PERFORM log_dispatch(t.id, p_rider_id, NULL, 'STUDENT_SELECTED_RIDER', c.score, c.breakdown, t.dispatch_state, 'assigned', 'student');
END $$;

CREATE OR REPLACE FUNCTION public.can_view_rider_photo(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM rider_applications a JOIN trips t ON t.rider_id=a.user_id
    WHERE a.avatar_path=_path AND is_group_member(t.group_id, auth.uid()))
  OR EXISTS (SELECT 1 FROM rider_applications a JOIN rider_availability av ON av.rider_id = a.user_id AND av.status = 'online'
    JOIN trips t ON t.status = 'confirmed' AND t.rider_id IS NULL AND is_group_member(t.group_id, auth.uid())
    WHERE a.avatar_path=_path AND a.status = 'approved' AND a.user_id IN (SELECT d.rider_id FROM dispatch_candidates(t.id) d))
$$;

CREATE OR REPLACE FUNCTION public.admin_trip_participants()
RETURNS TABLE(trip_id uuid, students integer, lecturers integer, passenger_pickup_confirms integer, rider_start_confirmed boolean, rider_at_destination boolean, rider_availability text, assignment_method text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN QUERY SELECT t.id,
    (SELECT count(*)::int FROM ride_group_members m LEFT JOIN student_profiles p ON p.id = m.student_id WHERE m.group_id = t.group_id AND coalesce(p.account_type,'student') <> 'lecturer'),
    (SELECT count(*)::int FROM ride_group_members m JOIN student_profiles p ON p.id = m.student_id WHERE m.group_id = t.group_id AND p.account_type = 'lecturer'),
    (SELECT count(*)::int FROM trip_confirmations c WHERE c.trip_id = t.id AND c.confirmation_type = 'pickup_start' AND c.role = 'passenger'),
    EXISTS (SELECT 1 FROM trip_confirmations c WHERE c.trip_id = t.id AND c.confirmation_type = 'pickup_start' AND c.role = 'rider'),
    EXISTS (SELECT 1 FROM trip_confirmations c WHERE c.trip_id = t.id AND c.confirmation_type = 'destination_arrival'),
    CASE WHEN t.rider_id IS NULL THEN NULL ELSE rider_availability_of(t.rider_id) END,
    (SELECT CASE e.event_type WHEN 'OFFER_ACCEPTED' THEN 'Smart Dispatch offer' WHEN 'RIDER_SELF_ACCEPTED' THEN 'Rider took waiting ride'
       WHEN 'STUDENT_SELECTED_RIDER' THEN 'Chosen by passenger' WHEN 'RIDER_ASSIGNED' THEN 'Admin assigned' WHEN 'RIDER_REASSIGNED' THEN 'Admin reassigned' END
     FROM dispatch_events e WHERE e.trip_id = t.id AND e.event_type IN ('OFFER_ACCEPTED','RIDER_SELF_ACCEPTED','STUDENT_SELECTED_RIDER','RIDER_ASSIGNED','RIDER_REASSIGNED')
     ORDER BY e.created_at DESC LIMIT 1)
  FROM trips t WHERE NOT trip_is_terminal(t.status);
END $$;

REVOKE EXECUTE ON FUNCTION public.student_available_riders(uuid), public.student_request_rider(uuid, uuid), public.admin_trip_participants() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.student_available_riders(uuid), public.student_request_rider(uuid, uuid), public.admin_trip_participants() TO authenticated;