ALTER TABLE public.trip_confirmations DROP CONSTRAINT trip_confirmations_confirmation_type_check;
ALTER TABLE public.trip_confirmations ADD CONSTRAINT trip_confirmations_confirmation_type_check
  CHECK (confirmation_type IN ('pickup_start','destination_arrival','completion'));

CREATE OR REPLACE FUNCTION public.rider_advance_trip(p_trip_id uuid, p_to text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t public.trips; uid uuid := auth.uid();
BEGIN
  IF NOT public.rider_is_eligible(uid) THEN RAISE EXCEPTION 'Only approved riders can update rides'; END IF;
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR t.rider_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'This ride is not assigned to you'; END IF;
  IF t.status = 'picked_up' AND p_to = 'in_progress' THEN
    IF EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id=t.id AND user_id=uid AND confirmation_type='pickup_start') THEN
      RAISE EXCEPTION 'You already confirmed. Waiting for a passenger to confirm pickup';
    END IF;
    INSERT INTO trip_confirmations(trip_id,user_id,role,confirmation_type,trip_status) VALUES (t.id,uid,'rider','pickup_start',t.status);
    PERFORM public.try_start_trip(t.id,'rider');
    RETURN;
  END IF;
  -- Destination: the rider only signals arrival; a passenger must confirm completion.
  IF t.status = 'in_progress' AND p_to = 'completed' THEN
    IF EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id=t.id AND confirmation_type='destination_arrival') THEN
      RAISE EXCEPTION 'You already marked arrival. Waiting for a passenger to confirm the ride is completed';
    END IF;
    INSERT INTO trip_confirmations(trip_id,user_id,role,confirmation_type,trip_status) VALUES (t.id,uid,'rider','destination_arrival',t.status);
    RETURN;
  END IF;
  IF NOT ((t.status = 'accepted' AND p_to = 'arriving') OR (t.status = 'arriving' AND p_to = 'picked_up')) THEN
    RAISE EXCEPTION 'That step is not allowed right now';
  END IF;
  UPDATE public.trips SET status = p_to,
    arriving_at = CASE WHEN p_to = 'arriving' THEN now() ELSE arriving_at END,
    arrived_at = CASE WHEN p_to = 'picked_up' THEN now() ELSE arrived_at END,
    picked_up_at = CASE WHEN p_to = 'picked_up' THEN now() ELSE picked_up_at END
  WHERE id = t.id;
  PERFORM public.log_trip_status(t.id, t.status, p_to, 'rider', NULL);
END; $function$;

CREATE OR REPLACE FUNCTION public.passenger_confirm_completion(p_trip_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t trips; uid uuid := auth.uid();
BEGIN
  SELECT * INTO t FROM trips WHERE id=p_trip_id FOR UPDATE;
  IF NOT FOUND OR uid IS NULL OR uid = t.rider_id OR NOT is_group_member(t.group_id, uid) THEN
    RAISE EXCEPTION 'You are not a passenger on this ride';
  END IF;
  IF EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id=t.id AND user_id=uid AND confirmation_type='completion') THEN
    RAISE EXCEPTION 'You already confirmed this ride is completed';
  END IF;
  IF t.status NOT IN ('in_progress','completed') THEN
    RAISE EXCEPTION 'You can confirm completion only after the ride has started and reached the destination';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id=t.id AND confirmation_type='destination_arrival') THEN
    RAISE EXCEPTION 'Your rider has not marked arrival at the destination yet';
  END IF;
  INSERT INTO trip_confirmations(trip_id,user_id,role,confirmation_type,trip_status) VALUES (t.id,uid,'passenger','completion',t.status);
  IF t.status = 'in_progress' THEN
    UPDATE trips SET status='completed', completed_at=now() WHERE id=t.id;
    UPDATE ride_groups SET status='completed' WHERE id=t.group_id;
    PERFORM log_trip_status(t.id,'in_progress','completed','student','Rider arrived and passenger confirmed completion');
    RETURN jsonb_build_object('completed', true);
  END IF;
  RETURN jsonb_build_object('completed', true);
END $function$;
REVOKE ALL ON FUNCTION public.passenger_confirm_completion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passenger_confirm_completion(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trip_rider_profile(p_trip_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t trips; uid uuid := auth.uid(); a rider_applications; av rider_availability; lat double precision; lng double precision; dist double precision;
BEGIN
  SELECT * INTO t FROM trips WHERE id=p_trip_id;
  IF NOT FOUND OR t.rider_id IS NULL THEN RETURN NULL; END IF;
  IF NOT (is_group_member(t.group_id, uid) OR has_role(uid,'admin')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO a FROM rider_applications WHERE user_id=t.rider_id AND status='approved' ORDER BY created_at DESC LIMIT 1;
  IF NOT trip_is_terminal(t.status) THEN
    SELECT * INTO av FROM rider_availability WHERE rider_id=t.rider_id;
    SELECT latitude, longitude INTO lat, lng FROM locations WHERE id=t.meeting_point_location_id;
    IF av.latitude IS NOT NULL AND lat IS NOT NULL AND av.location_at > now() - interval '10 minutes' THEN
      dist := round((geo_distance_m(av.latitude, av.longitude, lat, lng)/1000.0)::numeric, 1);
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'first_name', split_part(coalesce(a.full_name,'Rider'),' ',1),
    'avatar_path', a.avatar_path,
    'vehicle', a.vehicle_description,
    'plate', a.plate_number,
    'completed_rides', (SELECT count(*) FROM trips WHERE rider_id=t.rider_id AND status='completed'),
    'rating_avg', (SELECT round(avg(stars)::numeric,1) FROM rider_ratings WHERE rider_id=t.rider_id),
    'rating_count', (SELECT count(*) FROM rider_ratings WHERE rider_id=t.rider_id),
    'distance_km', dist,
    'my_rating', (SELECT stars FROM rider_ratings WHERE trip_id=t.id AND student_id=uid),
    'confirmations', (SELECT coalesce(jsonb_agg(jsonb_build_object('role',role,'type',confirmation_type,'is_me',user_id=uid,'at',created_at) ORDER BY created_at),'[]') FROM trip_confirmations WHERE trip_id=t.id)
  );
END $function$;