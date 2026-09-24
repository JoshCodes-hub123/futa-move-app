CREATE OR REPLACE FUNCTION public.ride_requests_group_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ts text;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND OLD.group_id IS NOT NULL THEN
    SELECT status INTO ts FROM public.trips WHERE group_id = OLD.group_id;
    IF ts IN ('picked_up','in_progress') OR public.trip_is_terminal(coalesce(ts, 'confirmed')) THEN
      RAISE EXCEPTION 'RIDE_CANNOT_BE_CANCELLED: This ride is already % and can no longer be cancelled.', replace(ts, '_', ' ');
    END IF;
    NEW.group_id := NULL;
    PERFORM public.release_request_from_group(OLD.id, OLD.group_id);
    RETURN NEW;
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'RIDE_CANNOT_BE_CANCELLED: A cancelled request cannot be reopened.';
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
END; $function$;

CREATE OR REPLACE FUNCTION public.set_my_location(p_lat double precision, p_lng double precision, p_accuracy double precision)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.rider_is_eligible(auth.uid()) THEN RAISE EXCEPTION 'Only approved riders can share location'; END IF;
  IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid location'; END IF;
  UPDATE public.rider_availability SET latitude = p_lat, longitude = p_lng, location_accuracy_m = p_accuracy, location_at = now()
  WHERE rider_id = auth.uid();
END; $function$;
GRANT EXECUTE ON FUNCTION public.set_my_location(double precision, double precision, double precision) TO authenticated;

UPDATE public.dispatch_settings SET weights = weights || '{"proximity": 20}'::jsonb WHERE NOT (weights ? 'proximity');

CREATE OR REPLACE FUNCTION public.dispatch_candidates(_trip uuid)
 RETURNS TABLE(rider_id uuid, score numeric, breakdown jsonb)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT tr.*, l.latitude AS mlat, l.longitude AS mlng FROM public.trips tr LEFT JOIN public.locations l ON l.id = tr.meeting_point_location_id WHERE tr.id = _trip),
  pool AS (
    SELECT a.rider_id, public.rider_dispatch_score(a.rider_id) AS b,
      CASE WHEN a.latitude IS NOT NULL AND a.location_at > now() - interval '10 minutes' AND t.mlat IS NOT NULL
        THEN public.geo_distance_m(a.latitude, a.longitude, t.mlat, t.mlng)::numeric END AS dist
    FROM public.rider_availability a, t
    WHERE a.status = 'online'
      AND public.rider_is_eligible(a.rider_id)
      AND NOT public.rider_is_busy(a.rider_id)
      AND NOT EXISTS (SELECT 1 FROM public.ride_offers o WHERE o.rider_id = a.rider_id AND o.response = 'pending')
      AND NOT EXISTS (SELECT 1 FROM public.ride_offers o WHERE o.rider_id = a.rider_id AND o.trip_id = t.id AND o.offered_at >= t.dispatch_started_at)
      AND t.passenger_count <= public.ride_capacity()
  ),
  w AS (SELECT coalesce((weights->>'proximity')::numeric, 0) AS pw FROM public.dispatch_settings WHERE id),
  scored AS (
    SELECT p.rider_id, p.b, p.dist,
      CASE WHEN p.dist IS NULL THEN 0::numeric ELSE round(w.pw * greatest(0::numeric, 1 - p.dist / 3000.0), 2) END AS bonus
    FROM pool p, w
  )
  SELECT rider_id, (b->>'score')::numeric + bonus,
    b || jsonb_build_object('score', (b->>'score')::numeric + bonus, 'fairness_score', (b->>'score')::numeric, 'proximity_bonus', bonus,
      'distance_m', round(dist),
      'proximity', CASE WHEN dist IS NULL THEN 'not available (no recent rider location or meeting point coordinates)'
                        ELSE round(dist) || ' m from meeting point (+' || bonus || ')' END,
      'eligibility', jsonb_build_array('Approved rider', 'Not suspended', 'Online', 'No active trip', 'No other pending offer'),
      'suitability', jsonb_build_array('Keke fits ' || (SELECT passenger_count FROM t) || ' passengers', 'Available now'))
  FROM scored ORDER BY (b->>'score')::numeric + bonus DESC, dist NULLS LAST, (b->>'hours_since_last_offer')::numeric DESC, rider_id $function$;

CREATE OR REPLACE FUNCTION public.admin_update_dispatch_settings(p_offer_timeout_seconds integer, p_max_offers integer, p_fairness_window_days integer, p_escalate_after_seconds integer, p_weights jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE k text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF p_offer_timeout_seconds NOT BETWEEN 20 AND 600 THEN RAISE EXCEPTION 'Offer timeout must be 20–600 seconds'; END IF;
  IF p_max_offers NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Maximum offers must be 1–20'; END IF;
  IF p_fairness_window_days NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Fairness window must be 1–30 days'; END IF;
  IF p_escalate_after_seconds NOT BETWEEN 60 AND 3600 THEN RAISE EXCEPTION 'Escalation wait must be 60–3600 seconds'; END IF;
  FOREACH k IN ARRAY ARRAY['base','completed_today','completed_window','offers_today','decline','timeout','withdrawal','no_show','idle_hour','offer_idle_hour','proximity'] LOOP
    IF jsonb_typeof(p_weights->k) IS DISTINCT FROM 'number' OR (p_weights->>k)::numeric < 0 OR (p_weights->>k)::numeric > 1000 THEN RAISE EXCEPTION 'Weight % must be a number between 0 and 1000', k; END IF;
  END LOOP;
  UPDATE public.dispatch_settings SET offer_timeout_seconds = p_offer_timeout_seconds, max_offers = p_max_offers, fairness_window_days = p_fairness_window_days,
    escalate_after_seconds = p_escalate_after_seconds, weights = p_weights, updated_at = now(), updated_by = auth.uid() WHERE id;
END; $function$;

CREATE TABLE public.ride_group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.ride_groups(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_group_messages_group_idx ON public.ride_group_messages (group_id, created_at);
GRANT SELECT ON public.ride_group_messages TO authenticated;
GRANT ALL ON public.ride_group_messages TO service_role;
ALTER TABLE public.ride_group_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read group messages" ON public.ride_group_messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.group_chat_open(_group_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.ride_groups g WHERE g.id = _group_id AND (
    g.status IN ('forming','ready')
    OR (g.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.group_id = g.id AND public.trip_is_terminal(t.status)))))
$$;

CREATE OR REPLACE FUNCTION public.list_group_messages(p_group_id uuid)
 RETURNS TABLE(id uuid, first_name text, is_me boolean, body text, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) OR NOT public.group_chat_open(p_group_id) THEN RETURN; END IF;
  RETURN QUERY SELECT m.id, coalesce(nullif(split_part(sp.full_name, ' ', 1), ''), 'Student'), m.sender_id = auth.uid(), m.body, m.created_at
    FROM public.ride_group_messages m LEFT JOIN public.student_profiles sp ON sp.id = m.sender_id
    WHERE m.group_id = p_group_id ORDER BY m.created_at DESC LIMIT 100;
END; $$;

CREATE OR REPLACE FUNCTION public.send_group_message(p_group_id uuid, p_body text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE b text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')); nid uuid;
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Only members of this group can send messages'; END IF;
  IF NOT public.group_chat_open(p_group_id) THEN RAISE EXCEPTION 'This group chat has closed'; END IF;
  IF b = '' OR char_length(b) > 500 THEN RAISE EXCEPTION 'Messages must be 1–500 characters'; END IF;
  IF (SELECT count(*) FROM public.ride_group_messages WHERE sender_id = auth.uid() AND created_at > now() - interval '1 minute') >= 15 THEN
    RAISE EXCEPTION 'You are sending messages too quickly'; END IF;
  INSERT INTO public.ride_group_messages (group_id, sender_id, body) VALUES (p_group_id, auth.uid(), b) RETURNING id INTO nid;
  RETURN nid;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_group_messages(uuid), public.send_group_message(uuid, text), public.group_chat_open(uuid) TO authenticated;