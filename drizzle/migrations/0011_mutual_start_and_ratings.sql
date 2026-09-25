CREATE TABLE public.trip_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('rider','passenger')),
  confirmation_type text NOT NULL CHECK (confirmation_type IN ('pickup_start')),
  trip_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id, confirmation_type)
);
GRANT SELECT ON public.trip_confirmations TO authenticated;
GRANT ALL ON public.trip_confirmations TO service_role;
ALTER TABLE public.trip_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants read confirmations" ON public.trip_confirmations FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND (t.rider_id = auth.uid() OR public.is_group_member(t.group_id, auth.uid())))
       OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.rider_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  rider_id uuid NOT NULL,
  student_id uuid NOT NULL,
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, student_id)
);
GRANT SELECT ON public.rider_ratings TO authenticated;
GRANT ALL ON public.rider_ratings TO service_role;
ALTER TABLE public.rider_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or admin ratings" ON public.rider_ratings FOR SELECT TO authenticated
USING (student_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- internal: start the ride when rider + at least one passenger confirmed
CREATE OR REPLACE FUNCTION public.try_start_trip(_trip uuid, _role text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id=_trip AND role='rider')
     AND EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id=_trip AND role='passenger') THEN
    UPDATE trips SET status='in_progress', started_at=now() WHERE id=_trip AND status='picked_up';
    IF FOUND THEN PERFORM log_trip_status(_trip,'picked_up','in_progress',_role,'Rider and passenger confirmed pickup'); RETURN true; END IF;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.try_start_trip(uuid,text) FROM PUBLIC, anon, authenticated;

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
  IF NOT ((t.status = 'accepted' AND p_to = 'arriving') OR (t.status = 'arriving' AND p_to = 'picked_up')
       OR (t.status = 'in_progress' AND p_to = 'completed')) THEN
    RAISE EXCEPTION 'That step is not allowed right now';
  END IF;
  UPDATE public.trips SET status = p_to,
    arriving_at = CASE WHEN p_to = 'arriving' THEN now() ELSE arriving_at END,
    arrived_at = CASE WHEN p_to = 'picked_up' THEN now() ELSE arrived_at END,
    picked_up_at = CASE WHEN p_to = 'picked_up' THEN now() ELSE picked_up_at END,
    completed_at = CASE WHEN p_to = 'completed' THEN now() ELSE completed_at END
  WHERE id = t.id;
  IF p_to = 'completed' THEN UPDATE public.ride_groups SET status = 'completed' WHERE id = t.group_id; END IF;
  PERFORM public.log_trip_status(t.id, t.status, p_to, 'rider', NULL);
END; $function$;

CREATE OR REPLACE FUNCTION public.passenger_confirm_pickup(p_trip_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t trips; uid uuid := auth.uid(); started boolean;
BEGIN
  SELECT * INTO t FROM trips WHERE id=p_trip_id FOR UPDATE;
  IF NOT FOUND OR NOT is_group_member(t.group_id, uid) THEN RAISE EXCEPTION 'You are not a passenger on this ride'; END IF;
  IF t.status NOT IN ('picked_up','in_progress') THEN RAISE EXCEPTION 'You can confirm pickup only after your rider has arrived'; END IF;
  IF EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id=t.id AND user_id=uid AND confirmation_type='pickup_start') THEN
    RAISE EXCEPTION 'You already confirmed pickup';
  END IF;
  INSERT INTO trip_confirmations(trip_id,user_id,role,confirmation_type,trip_status) VALUES (t.id,uid,'passenger','pickup_start',t.status);
  started := try_start_trip(t.id,'student');
  RETURN jsonb_build_object('started', started OR t.status='in_progress');
END $$;
GRANT EXECUTE ON FUNCTION public.passenger_confirm_pickup(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rate_rider(p_trip_id uuid, p_stars integer, p_tags text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t trips; uid uuid := auth.uid();
  allowed text[] := ARRAY['Friendly','On time','Safe driving','Good communication','Clean keke','Late arrival','Communication issue','Driving concern','Vehicle issue','Other'];
BEGIN
  SELECT * INTO t FROM trips WHERE id=p_trip_id;
  IF NOT FOUND OR NOT is_group_member(t.group_id, uid) THEN RAISE EXCEPTION 'You can only rate rides you took'; END IF;
  IF t.status <> 'completed' OR t.rider_id IS NULL THEN RAISE EXCEPTION 'You can rate only completed rides'; END IF;
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN RAISE EXCEPTION 'Choose 1 to 5 stars'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_tags,'{}')) x WHERE x <> ALL(allowed)) THEN RAISE EXCEPTION 'Invalid feedback option'; END IF;
  IF EXISTS (SELECT 1 FROM rider_ratings WHERE trip_id=t.id AND student_id=uid) THEN RAISE EXCEPTION 'You already rated this ride'; END IF;
  INSERT INTO rider_ratings(trip_id,rider_id,student_id,stars,tags) VALUES (t.id,t.rider_id,uid,p_stars,coalesce(p_tags,'{}'));
END $$;
GRANT EXECUTE ON FUNCTION public.rate_rider(uuid,integer,text[]) TO authenticated;

-- Public rider card for passengers of a trip. Average = mean of all stars on completed trips, 1 decimal; null => "New Rider".
CREATE OR REPLACE FUNCTION public.trip_rider_profile(p_trip_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'confirmations', (SELECT coalesce(jsonb_agg(jsonb_build_object('role',role,'is_me',user_id=uid,'at',created_at) ORDER BY created_at),'[]') FROM trip_confirmations WHERE trip_id=t.id)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.trip_rider_profile(uuid) TO authenticated;

-- Let passengers see their rider's profile photo only.
CREATE OR REPLACE FUNCTION public.can_view_rider_photo(_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM rider_applications a JOIN trips t ON t.rider_id=a.user_id
    WHERE a.avatar_path=_path AND is_group_member(t.group_id, auth.uid()))
$$;
CREATE POLICY "passengers view rider photo" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='rider-documents' AND public.can_view_rider_photo(name));