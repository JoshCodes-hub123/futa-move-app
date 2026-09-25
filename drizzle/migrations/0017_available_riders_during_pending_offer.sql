CREATE OR REPLACE FUNCTION public.student_available_riders(p_trip_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t trips; uid uuid := auth.uid();
BEGIN
  SELECT * INTO t FROM trips WHERE id = p_trip_id;
  IF NOT FOUND OR NOT is_group_member(t.group_id, uid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF t.status <> 'confirmed' OR t.rider_id IS NOT NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'assigned', 'riders', '[]'::jsonb); END IF;
  -- A pending Smart Dispatch offer no longer hides the list: Smart Dispatch re-offers continuously,
  -- so the list would never appear. dispatch_candidates already excludes riders holding an offer.
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
END $function$;

CREATE OR REPLACE FUNCTION public.student_request_rider(p_trip_id uuid, p_rider_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t trips; uid uuid := auth.uid(); c record; o record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rider-trip:' || p_rider_id::text));
  SELECT * INTO t FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR NOT is_group_member(t.group_id, uid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF t.status <> 'confirmed' OR t.rider_id IS NOT NULL THEN RAISE EXCEPTION 'A rider has already been found for this ride'; END IF;
  SELECT * INTO c FROM dispatch_candidates(t.id) d WHERE d.rider_id = p_rider_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'This rider is no longer available. Pick another rider or keep waiting.'; END IF;
  -- Passenger's choice replaces any pending automatic offer (audited).
  FOR o IN SELECT * FROM ride_offers WHERE trip_id = t.id AND response = 'pending' FOR UPDATE LOOP
    UPDATE ride_offers SET response = 'cancelled', responded_at = now(), response_reason = 'Passenger chose another rider' WHERE id = o.id;
    PERFORM log_dispatch(t.id, o.rider_id, o.id, 'OFFER_CANCELLED', NULL, jsonb_build_object('reason','passenger_selected_rider'), t.dispatch_state, t.dispatch_state, 'student');
  END LOOP;
  UPDATE trips SET rider_id = p_rider_id, status = 'assigned', assigned_at = now(), accepted_at = NULL WHERE id = t.id;
  PERFORM log_trip_status(t.id, 'confirmed', 'assigned', 'student', 'Passenger chose an available rider');
  PERFORM log_dispatch(t.id, p_rider_id, NULL, 'STUDENT_SELECTED_RIDER', c.score, c.breakdown, t.dispatch_state, 'assigned', 'student');
END $function$;