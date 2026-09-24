-- ============ Configuration (admin-managed) ============
CREATE TABLE public.dispatch_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  offer_timeout_seconds int NOT NULL DEFAULT 60,
  max_offers int NOT NULL DEFAULT 5,
  fairness_window_days int NOT NULL DEFAULT 7,
  escalate_after_seconds int NOT NULL DEFAULT 300,
  weights jsonb NOT NULL DEFAULT '{"base":100,"completed_today":12,"completed_window":3,"offers_today":4,"decline":0.5,"timeout":3,"withdrawal":15,"no_show":35,"idle_hour":1.5,"offer_idle_hour":0.5}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.dispatch_settings (id) VALUES (true);
GRANT SELECT ON public.dispatch_settings TO authenticated;
GRANT ALL ON public.dispatch_settings TO service_role;
ALTER TABLE public.dispatch_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read dispatch settings" ON public.dispatch_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ Rider availability (operational, separate from approval) ============
CREATE TABLE public.rider_availability (
  rider_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','busy')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  -- Future GPS inputs; never populated with fake data
  latitude double precision, longitude double precision, location_accuracy_m double precision, location_at timestamptz
);
CREATE INDEX rider_availability_status_idx ON public.rider_availability(status);
GRANT SELECT ON public.rider_availability TO authenticated;
GRANT ALL ON public.rider_availability TO service_role;
ALTER TABLE public.rider_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Riders read own availability" ON public.rider_availability FOR SELECT TO authenticated USING (rider_id = auth.uid());
CREATE POLICY "Admins read availability" ON public.rider_availability FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ Trips gain a dispatch state ============
ALTER TABLE public.trips ADD COLUMN dispatch_state text NOT NULL DEFAULT 'searching'
  CHECK (dispatch_state IN ('searching','offer_pending','escalated','assigned','closed'));
ALTER TABLE public.trips ADD COLUMN dispatch_started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.trips ADD COLUMN escalated_at timestamptz;
UPDATE public.trips SET dispatch_state = CASE WHEN public.trip_is_terminal(status) THEN 'closed' WHEN rider_id IS NOT NULL THEN 'assigned' ELSE 'searching' END,
  dispatch_started_at = confirmed_at;
CREATE INDEX trips_dispatch_idx ON public.trips(dispatch_state) WHERE dispatch_state IN ('searching','offer_pending','escalated');

-- ============ Ride offers ============
CREATE TABLE public.ride_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  rider_id uuid NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','accepted','declined','timed_out','cancelled','expired')),
  response_reason text,
  dispatch_score numeric,
  dispatch_reason jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ride_offers_one_pending_per_trip ON public.ride_offers(trip_id) WHERE response = 'pending';
CREATE UNIQUE INDEX ride_offers_one_pending_per_rider ON public.ride_offers(rider_id) WHERE response = 'pending';
CREATE UNIQUE INDEX ride_offers_one_accepted_per_trip ON public.ride_offers(trip_id) WHERE response = 'accepted';
CREATE INDEX ride_offers_rider_idx ON public.ride_offers(rider_id, offered_at DESC);
CREATE INDEX ride_offers_expiry_idx ON public.ride_offers(expires_at) WHERE response = 'pending';
CREATE TRIGGER ride_offers_set_updated_at BEFORE UPDATE ON public.ride_offers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
GRANT SELECT ON public.ride_offers TO authenticated;
GRANT ALL ON public.ride_offers TO service_role;
ALTER TABLE public.ride_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Riders read own offers" ON public.ride_offers FOR SELECT TO authenticated USING (rider_id = auth.uid());
CREATE POLICY "Admins read offers" ON public.ride_offers FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ Dispatch audit trail ============
CREATE TABLE public.dispatch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  rider_id uuid,
  offer_id uuid REFERENCES public.ride_offers(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  dispatch_score numeric,
  reason jsonb,
  from_state text, to_state text,
  actor_id uuid, actor_role text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispatch_events_trip_idx ON public.dispatch_events(trip_id, created_at);
CREATE INDEX dispatch_events_rider_idx ON public.dispatch_events(rider_id, event_type, created_at);
GRANT SELECT ON public.dispatch_events TO authenticated;
GRANT ALL ON public.dispatch_events TO service_role;
ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read dispatch events" ON public.dispatch_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ Explicit errors for direct writes ============
CREATE OR REPLACE FUNCTION public.block_direct_ride_writes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_TO_CHANGE_TRIP_STATUS' USING ERRCODE = '42501',
      HINT = 'Ride changes must go through FUTAMOVE ride actions.';
  END IF;
  RETURN NULL;
END; $$;
-- Grant writes only so the statement trigger always runs and returns the structured error (RLS still has no write policies).
GRANT INSERT, UPDATE, DELETE ON public.trips TO authenticated;
CREATE TRIGGER trips_block_direct BEFORE INSERT OR UPDATE OR DELETE ON public.trips FOR EACH STATEMENT EXECUTE FUNCTION public.block_direct_ride_writes();
CREATE TRIGGER offers_block_direct BEFORE INSERT OR UPDATE OR DELETE ON public.ride_offers FOR EACH STATEMENT EXECUTE FUNCTION public.block_direct_ride_writes();
CREATE TRIGGER events_block_direct BEFORE INSERT OR UPDATE OR DELETE ON public.dispatch_events FOR EACH STATEMENT EXECUTE FUNCTION public.block_direct_ride_writes();
CREATE TRIGGER history_block_direct BEFORE INSERT OR UPDATE OR DELETE ON public.trip_status_history FOR EACH STATEMENT EXECUTE FUNCTION public.block_direct_ride_writes();
CREATE TRIGGER availability_block_direct BEFORE INSERT OR UPDATE OR DELETE ON public.rider_availability FOR EACH STATEMENT EXECUTE FUNCTION public.block_direct_ride_writes();

-- ============ Helpers ============
CREATE OR REPLACE FUNCTION public.log_dispatch(_trip uuid, _rider uuid, _offer uuid, _type text, _score numeric, _reason jsonb, _from text, _to text, _role text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.dispatch_events (trip_id, rider_id, offer_id, event_type, dispatch_score, reason, from_state, to_state, actor_id, actor_role)
  VALUES (_trip, _rider, _offer, _type, _score, _reason, _from, _to, auth.uid(), coalesce(_role, 'system')) $$;
REVOKE EXECUTE ON FUNCTION public.log_dispatch(uuid, uuid, uuid, text, numeric, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rider_availability_of(_uid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT status FROM public.rider_availability WHERE rider_id = _uid), 'offline') $$;

-- Transparent fairness score (rolling windows; declines barely count; withdrawals/no-shows count most)
CREATE OR REPLACE FUNCTION public.rider_dispatch_score(_uid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.dispatch_settings; w jsonb; win timestamptz; today timestamptz;
  ct int; cw int; ot int; dw int; tw int; ww int; nw int; last_c timestamptz; last_o timestamptz; hc numeric; ho numeric; score numeric;
BEGIN
  SELECT * INTO s FROM public.dispatch_settings WHERE id; w := s.weights;
  win := now() - make_interval(days => s.fairness_window_days);
  today := (date_trunc('day', now() AT TIME ZONE 'Africa/Lagos')) AT TIME ZONE 'Africa/Lagos';
  SELECT count(*) FILTER (WHERE completed_at >= today), count(*) FILTER (WHERE completed_at >= win), max(completed_at)
    INTO ct, cw, last_c FROM public.trips WHERE rider_id = _uid AND status = 'completed';
  SELECT count(*) FILTER (WHERE offered_at >= today), count(*) FILTER (WHERE response = 'declined' AND offered_at >= win),
         count(*) FILTER (WHERE response = 'timed_out' AND offered_at >= win), max(offered_at)
    INTO ot, dw, tw, last_o FROM public.ride_offers WHERE rider_id = _uid;
  SELECT count(*) FILTER (WHERE event_type = 'RIDER_WITHDREW'), count(*) FILTER (WHERE event_type = 'RIDER_NO_SHOW')
    INTO ww, nw FROM public.dispatch_events WHERE rider_id = _uid AND created_at >= win;
  hc := least(coalesce(extract(epoch FROM now() - last_c) / 3600, 24), 24);
  ho := least(coalesce(extract(epoch FROM now() - last_o) / 3600, 24), 24);
  score := (w->>'base')::numeric - (w->>'completed_today')::numeric * ct - (w->>'completed_window')::numeric * cw
    - (w->>'offers_today')::numeric * ot - (w->>'decline')::numeric * dw - (w->>'timeout')::numeric * tw
    - (w->>'withdrawal')::numeric * ww - (w->>'no_show')::numeric * nw
    + (w->>'idle_hour')::numeric * hc + (w->>'offer_idle_hour')::numeric * ho;
  RETURN jsonb_build_object('score', round(score, 2), 'completed_today', ct, 'completed_window', cw, 'offers_today', ot,
    'declines_window', dw, 'timeouts_window', tw, 'withdrawals_window', ww, 'no_shows_window', nw,
    'hours_since_last_completed', round(hc, 1), 'hours_since_last_offer', round(ho, 1), 'window_days', s.fairness_window_days,
    'proximity', 'not available (no live location yet)');
END; $$;
REVOKE EXECUTE ON FUNCTION public.rider_dispatch_score(uuid) FROM PUBLIC, anon, authenticated;

-- Eligible + suitable candidates for a trip, best first
CREATE OR REPLACE FUNCTION public.dispatch_candidates(_trip uuid) RETURNS TABLE(rider_id uuid, score numeric, breakdown jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT * FROM public.trips WHERE id = _trip),
  pool AS (
    SELECT a.rider_id, public.rider_dispatch_score(a.rider_id) AS b
    FROM public.rider_availability a, t
    WHERE a.status = 'online'
      AND public.rider_is_eligible(a.rider_id)
      AND NOT public.rider_is_busy(a.rider_id)
      AND NOT EXISTS (SELECT 1 FROM public.ride_offers o WHERE o.rider_id = a.rider_id AND o.response = 'pending')
      AND NOT EXISTS (SELECT 1 FROM public.ride_offers o WHERE o.rider_id = a.rider_id AND o.trip_id = t.id AND o.offered_at >= t.dispatch_started_at)
      AND t.passenger_count <= public.ride_capacity()
  )
  SELECT rider_id, (b->>'score')::numeric,
    b || jsonb_build_object('eligibility', jsonb_build_array('Approved rider', 'Not suspended', 'Online', 'No active trip', 'No other pending offer'),
      'suitability', jsonb_build_array('Keke fits ' || (SELECT passenger_count FROM t) || ' passengers', 'Available now'))
  FROM pool ORDER BY (b->>'score')::numeric DESC, (b->>'hours_since_last_offer')::numeric DESC, rider_id $$;
REVOKE EXECUTE ON FUNCTION public.dispatch_candidates(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dispatch_escalate(_trip uuid, _why text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st text;
BEGIN
  SELECT dispatch_state INTO st FROM public.trips WHERE id = _trip;
  IF st = 'escalated' THEN RETURN; END IF;
  UPDATE public.trips SET dispatch_state = 'escalated', escalated_at = now() WHERE id = _trip;
  PERFORM public.log_dispatch(_trip, NULL, NULL, 'DISPATCH_ESCALATED', NULL,
    jsonb_build_object('why', _why, 'offers', (SELECT count(*) FROM public.ride_offers o JOIN public.trips t ON t.id = o.trip_id WHERE o.trip_id = _trip AND o.offered_at >= t.dispatch_started_at)),
    st, 'escalated', 'system');
END; $$;
REVOKE EXECUTE ON FUNCTION public.dispatch_escalate(uuid, text) FROM PUBLIC, anon, authenticated;

-- Core engine step: offer the trip to the best candidate, or escalate
CREATE OR REPLACE FUNCTION public.dispatch_trip(_trip uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips; s public.dispatch_settings; n int; c record; oid uuid;
BEGIN
  SELECT * INTO t FROM public.trips WHERE id = _trip FOR UPDATE;
  IF NOT FOUND OR t.status <> 'confirmed' OR t.rider_id IS NOT NULL OR t.dispatch_state = 'escalated' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.ride_offers WHERE trip_id = _trip AND response = 'pending') THEN RETURN; END IF;
  SELECT * INTO s FROM public.dispatch_settings WHERE id;
  SELECT count(*) INTO n FROM public.ride_offers WHERE trip_id = _trip AND offered_at >= t.dispatch_started_at;
  IF n >= s.max_offers THEN PERFORM public.dispatch_escalate(_trip, 'No rider accepted after ' || n || ' offers'); RETURN; END IF;
  FOR c IN SELECT * FROM public.dispatch_candidates(_trip) LOOP
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtext('rider-trip:' || c.rider_id::text));
    CONTINUE WHEN public.rider_is_busy(c.rider_id) OR EXISTS (SELECT 1 FROM public.ride_offers WHERE rider_id = c.rider_id AND response = 'pending');
    INSERT INTO public.ride_offers (trip_id, rider_id, expires_at, dispatch_score, dispatch_reason)
    VALUES (_trip, c.rider_id, now() + make_interval(secs => s.offer_timeout_seconds), c.score, c.breakdown) RETURNING id INTO oid;
    PERFORM public.log_dispatch(_trip, c.rider_id, oid, 'CANDIDATE_SELECTED', c.score, c.breakdown, t.dispatch_state, t.dispatch_state, 'system');
    PERFORM public.log_dispatch(_trip, c.rider_id, oid, 'OFFER_CREATED', c.score, jsonb_build_object('expires_in_seconds', s.offer_timeout_seconds), t.dispatch_state, 'offer_pending', 'system');
    UPDATE public.trips SET dispatch_state = 'offer_pending' WHERE id = _trip;
    RETURN;
  END LOOP;
  IF t.dispatch_state <> 'searching' THEN UPDATE public.trips SET dispatch_state = 'searching' WHERE id = _trip; END IF;
  IF now() - t.dispatch_started_at > make_interval(secs => s.escalate_after_seconds) THEN
    PERFORM public.dispatch_escalate(_trip, CASE WHEN n = 0 THEN 'No suitable rider available' ELSE 'No other suitable rider available' END);
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.dispatch_trip(uuid) FROM PUBLIC, anon, authenticated;

-- Sweep run whenever riders, students or admins look at rides: time out offers, retry, escalate long waits
CREATE OR REPLACE FUNCTION public.dispatch_tick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; tid uuid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('futamove-dispatch-tick')) THEN RETURN; END IF;
  FOR o IN SELECT * FROM public.ride_offers WHERE response = 'pending' AND expires_at < now() FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.ride_offers SET response = 'timed_out', responded_at = now() WHERE id = o.id;
    PERFORM public.log_dispatch(o.trip_id, o.rider_id, o.id, 'OFFER_TIMED_OUT', o.dispatch_score, NULL, 'offer_pending', 'searching', 'system');
    UPDATE public.trips SET dispatch_state = 'searching' WHERE id = o.trip_id AND dispatch_state = 'offer_pending';
    PERFORM public.dispatch_trip(o.trip_id);
  END LOOP;
  FOR tid IN SELECT id FROM public.trips WHERE status = 'confirmed' AND rider_id IS NULL AND dispatch_state IN ('searching','offer_pending')
      AND NOT EXISTS (SELECT 1 FROM public.ride_offers WHERE trip_id = trips.id AND response = 'pending') LOOP
    UPDATE public.trips SET dispatch_state = 'searching' WHERE id = tid AND dispatch_state = 'offer_pending';
    PERFORM public.dispatch_trip(tid);
  END LOOP;
END; $$;
REVOKE EXECUTE ON FUNCTION public.dispatch_tick() FROM PUBLIC, anon, authenticated;

-- ============ Keep dispatch state in step with trip status ============
CREATE OR REPLACE FUNCTION public.trips_dispatch_state_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    IF public.trip_is_terminal(NEW.status) THEN NEW.dispatch_state := 'closed';
    ELSIF NEW.rider_id IS NOT NULL THEN NEW.dispatch_state := 'assigned';
    ELSIF NEW.status = 'confirmed' AND OLD.dispatch_state IN ('assigned','closed') THEN
      NEW.dispatch_state := 'searching'; NEW.dispatch_started_at := now(); NEW.escalated_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trips_dispatch_state_sync BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.trips_dispatch_state_sync();

CREATE OR REPLACE FUNCTION public.trips_after_change_dispatch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM public.dispatch_trip(NEW.id); RETURN NULL; END IF;
  IF NEW.rider_id IS NOT NULL OR public.trip_is_terminal(NEW.status) THEN
    UPDATE public.ride_offers SET response = CASE WHEN public.trip_is_terminal(NEW.status) THEN 'expired' ELSE 'cancelled' END,
      responded_at = now(), response_reason = 'Ride no longer needs this offer'
    WHERE trip_id = NEW.id AND response = 'pending';
  ELSIF NEW.status = 'confirmed' AND OLD.dispatch_state IN ('assigned','closed') THEN
    PERFORM public.dispatch_trip(NEW.id);
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER trips_after_insert_dispatch AFTER INSERT ON public.trips FOR EACH ROW EXECUTE FUNCTION public.trips_after_change_dispatch();
CREATE TRIGGER trips_after_update_dispatch AFTER UPDATE OF status, rider_id ON public.trips FOR EACH ROW EXECUTE FUNCTION public.trips_after_change_dispatch();

-- ============ Rider RPCs ============
CREATE OR REPLACE FUNCTION public.set_my_availability(p_status text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); o record;
BEGIN
  IF NOT public.rider_is_eligible(uid) THEN RAISE EXCEPTION 'Only approved riders can go online'; END IF;
  IF p_status NOT IN ('online','offline','busy') THEN RAISE EXCEPTION 'Unknown availability'; END IF;
  INSERT INTO public.rider_availability (rider_id, status, changed_at) VALUES (uid, p_status, now())
  ON CONFLICT (rider_id) DO UPDATE SET status = excluded.status, changed_at = now();
  IF p_status <> 'online' THEN
    FOR o IN SELECT * FROM public.ride_offers WHERE rider_id = uid AND response = 'pending' FOR UPDATE LOOP
      UPDATE public.ride_offers SET response = 'cancelled', responded_at = now(), response_reason = 'Rider went ' || p_status WHERE id = o.id;
      PERFORM public.log_dispatch(o.trip_id, uid, o.id, 'OFFER_CANCELLED', o.dispatch_score, jsonb_build_object('why', 'Rider went ' || p_status), 'offer_pending', 'searching', 'rider');
      UPDATE public.trips SET dispatch_state = 'searching' WHERE id = o.trip_id AND dispatch_state = 'offer_pending';
      PERFORM public.dispatch_trip(o.trip_id);
    END LOOP;
  ELSE
    PERFORM public.dispatch_tick();
  END IF;
  RETURN p_status;
END; $$;

CREATE OR REPLACE FUNCTION public.rider_my_offers() RETURNS TABLE(offer_id uuid, trip_id uuid, meeting_point_text text, meeting_point_note text, destination_text text,
  departure_time timestamptz, passenger_count int, member_count int, offered_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rider_is_eligible(auth.uid()) THEN RAISE EXCEPTION 'Only approved riders can view ride offers'; END IF;
  PERFORM public.dispatch_tick();
  RETURN QUERY SELECT o.id, t.id, t.meeting_point_text, t.meeting_point_note, t.destination_text, t.departure_time, t.passenger_count, t.member_count, o.offered_at, o.expires_at
  FROM public.ride_offers o JOIN public.trips t ON t.id = o.trip_id
  WHERE o.rider_id = auth.uid() AND o.response = 'pending' AND o.expires_at > now();
END; $$;

CREATE OR REPLACE FUNCTION public.rider_respond_offer(p_offer_id uuid, p_accept boolean, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.ride_offers; t public.trips; uid uuid := auth.uid();
BEGIN
  IF NOT public.rider_is_eligible(uid) THEN RAISE EXCEPTION 'Only approved riders can respond to offers'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('rider-trip:' || uid::text));
  SELECT * INTO o FROM public.ride_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR o.rider_id <> uid THEN RAISE EXCEPTION 'This offer is not yours'; END IF;
  IF o.response <> 'pending' THEN RAISE EXCEPTION 'This offer is no longer available'; END IF;
  SELECT * INTO t FROM public.trips WHERE id = o.trip_id FOR UPDATE;
  IF o.expires_at <= now() THEN
    UPDATE public.ride_offers SET response = 'timed_out', responded_at = now() WHERE id = o.id;
    PERFORM public.log_dispatch(o.trip_id, uid, o.id, 'OFFER_TIMED_OUT', o.dispatch_score, NULL, 'offer_pending', 'searching', 'system');
    UPDATE public.trips SET dispatch_state = 'searching' WHERE id = o.trip_id AND dispatch_state = 'offer_pending';
    PERFORM public.dispatch_trip(o.trip_id);
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF NOT p_accept THEN
    UPDATE public.ride_offers SET response = 'declined', responded_at = now(), response_reason = nullif(left(btrim(coalesce(p_reason,'')), 300), '') WHERE id = o.id;
    PERFORM public.log_dispatch(o.trip_id, uid, o.id, 'OFFER_DECLINED', o.dispatch_score, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')), '')), 'offer_pending', 'searching', 'rider');
    UPDATE public.trips SET dispatch_state = 'searching' WHERE id = o.trip_id AND dispatch_state = 'offer_pending';
    PERFORM public.dispatch_trip(o.trip_id);
    RETURN jsonb_build_object('ok', true, 'response', 'declined');
  END IF;
  IF t.status <> 'confirmed' OR t.rider_id IS NOT NULL THEN RAISE EXCEPTION 'This ride is no longer available'; END IF;
  IF public.rider_is_busy(uid) THEN RAISE EXCEPTION 'Finish your current ride before accepting another'; END IF;
  UPDATE public.ride_offers SET response = 'accepted', responded_at = now() WHERE id = o.id;
  UPDATE public.trips SET rider_id = uid, status = 'accepted', assigned_at = now(), accepted_at = now() WHERE id = t.id;
  PERFORM public.log_trip_status(t.id, 'confirmed', 'accepted', 'rider', 'Rider accepted a dispatch offer');
  PERFORM public.log_dispatch(t.id, uid, o.id, 'OFFER_ACCEPTED', o.dispatch_score, NULL, 'offer_pending', 'assigned', 'rider');
  PERFORM public.log_dispatch(t.id, uid, o.id, 'RIDER_ASSIGNED', o.dispatch_score, jsonb_build_object('via', 'dispatch offer'), 'offer_pending', 'assigned', 'rider');
  RETURN jsonb_build_object('ok', true, 'response', 'accepted');
END; $$;

CREATE OR REPLACE FUNCTION public.rider_available_trips() RETURNS TABLE(id uuid, meeting_point_text text, meeting_point_note text, destination_text text,
  departure_time timestamptz, passenger_count int, member_count int, confirmed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rider_is_eligible(auth.uid()) THEN RAISE EXCEPTION 'Only approved riders can view available rides'; END IF;
  RETURN QUERY SELECT t.id, t.meeting_point_text, t.meeting_point_note, t.destination_text, t.departure_time, t.passenger_count, t.member_count, t.confirmed_at
  FROM public.trips t WHERE t.status = 'confirmed' AND t.rider_id IS NULL AND t.dispatch_state IN ('searching','escalated')
    AND NOT EXISTS (SELECT 1 FROM public.ride_offers o WHERE o.trip_id = t.id AND o.response = 'pending')
  ORDER BY t.departure_time;
END; $$;

CREATE OR REPLACE FUNCTION public.rider_claim_trip(p_trip_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips; uid uuid := auth.uid();
BEGIN
  IF NOT public.rider_is_eligible(uid) THEN RAISE EXCEPTION 'Only approved riders can accept rides'; END IF;
  IF public.rider_availability_of(uid) <> 'online' THEN RAISE EXCEPTION 'Go online before accepting rides'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('rider-trip:' || uid::text));
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF t.status <> 'confirmed' OR t.rider_id IS NOT NULL THEN RAISE EXCEPTION 'This ride is no longer available'; END IF;
  IF EXISTS (SELECT 1 FROM public.ride_offers WHERE trip_id = t.id AND response = 'pending') THEN RAISE EXCEPTION 'This ride is currently offered to another rider'; END IF;
  IF EXISTS (SELECT 1 FROM public.ride_offers WHERE rider_id = uid AND response = 'pending') THEN RAISE EXCEPTION 'Respond to your pending offer first'; END IF;
  IF public.rider_is_busy(uid) THEN RAISE EXCEPTION 'Finish your current ride before accepting another'; END IF;
  UPDATE public.trips SET rider_id = uid, status = 'accepted', assigned_at = now(), accepted_at = now() WHERE id = t.id;
  PERFORM public.log_trip_status(t.id, t.status, 'accepted', 'rider', 'Rider accepted an available ride');
  PERFORM public.log_dispatch(t.id, uid, NULL, 'RIDER_SELF_ACCEPTED', NULL, public.rider_dispatch_score(uid), t.dispatch_state, 'assigned', 'rider');
END; $$;

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
    PERFORM public.log_dispatch(t.id, uid, NULL, 'ASSIGNMENT_ACCEPTED', NULL, NULL, 'assigned', 'assigned', 'rider');
  ELSE
    PERFORM public.log_trip_status(t.id, 'assigned', 'confirmed', 'rider', coalesce(nullif(btrim(p_reason), ''), 'Rider rejected the assignment'));
    PERFORM public.log_dispatch(t.id, uid, NULL, 'ASSIGNMENT_DECLINED', NULL, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')), '')), 'assigned', 'searching', 'rider');
    UPDATE public.trips SET status = 'confirmed', rider_id = NULL, assigned_at = NULL WHERE id = t.id;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.rider_withdraw_trip(p_trip_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips; uid uuid := auth.uid();
BEGIN
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR t.rider_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'This ride is not assigned to you'; END IF;
  IF t.status NOT IN ('accepted','arriving') THEN RAISE EXCEPTION 'You can only withdraw before picking up passengers'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Tell us why you are withdrawing'; END IF;
  PERFORM public.log_trip_status(t.id, t.status, 'confirmed', 'rider', 'Rider withdrew: ' || btrim(p_reason));
  PERFORM public.log_dispatch(t.id, uid, NULL, 'RIDER_WITHDREW', NULL, jsonb_build_object('reason', btrim(p_reason), 'from', t.status), 'assigned', 'searching', 'rider');
  UPDATE public.trips SET status = 'confirmed', rider_id = NULL, assigned_at = NULL, accepted_at = NULL, arriving_at = NULL WHERE id = t.id;
END; $$;

-- ============ Student: nudge dispatch while waiting (no scoring exposed) ============
CREATE OR REPLACE FUNCTION public.student_dispatch_ping(p_group_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN RAISE EXCEPTION 'Not a member of this group'; END IF;
  PERFORM public.dispatch_tick();
END; $$;

-- ============ Admin RPCs ============
DROP FUNCTION public.admin_assign_rider(uuid, uuid);
CREATE FUNCTION public.admin_assign_rider(p_trip_id uuid, p_rider_id uuid, p_override boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF NOT public.rider_is_eligible(p_rider_id) THEN RAISE EXCEPTION 'This rider is not approved or is suspended'; END IF;
  IF public.rider_availability_of(p_rider_id) <> 'online' AND NOT coalesce(p_override, false) THEN
    RAISE EXCEPTION 'This rider is not online. Use emergency override to assign anyway.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('rider-trip:' || p_rider_id::text));
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF t.status NOT IN ('confirmed','assigned','accepted') THEN RAISE EXCEPTION 'Riders can only be assigned before they head to the meeting point'; END IF;
  IF t.rider_id = p_rider_id THEN RAISE EXCEPTION 'This rider is already on this ride'; END IF;
  IF public.rider_is_busy(p_rider_id, t.id) THEN RAISE EXCEPTION 'This rider already has an active ride'; END IF;
  UPDATE public.ride_offers SET response = 'cancelled', responded_at = now(), response_reason = 'Rider assigned to another ride by admin'
  WHERE rider_id = p_rider_id AND response = 'pending' AND trip_id <> t.id;
  UPDATE public.trips SET rider_id = p_rider_id, status = 'assigned', assigned_at = now(), accepted_at = NULL WHERE id = t.id;
  PERFORM public.log_trip_status(t.id, t.status, 'assigned', 'admin', CASE WHEN t.rider_id IS NULL THEN 'Rider assigned' ELSE 'Rider reassigned' END);
  PERFORM public.log_dispatch(t.id, p_rider_id, NULL, CASE WHEN t.rider_id IS NULL THEN 'RIDER_ASSIGNED' ELSE 'RIDER_REASSIGNED' END, NULL,
    jsonb_build_object('override', coalesce(p_override, false), 'previous_rider', t.rider_id), t.dispatch_state, 'assigned', 'admin');
  PERFORM public.dispatch_tick();
END; $$;

CREATE OR REPLACE FUNCTION public.admin_mark_rider_no_show(p_trip_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF t.status NOT IN ('assigned','accepted','arriving') OR t.rider_id IS NULL THEN RAISE EXCEPTION 'Only a rider who has not picked up passengers can be marked as a no-show'; END IF;
  PERFORM public.log_trip_status(t.id, t.status, 'confirmed', 'admin', 'Rider no-show: ' || btrim(p_reason));
  PERFORM public.log_dispatch(t.id, t.rider_id, NULL, 'RIDER_NO_SHOW', NULL, jsonb_build_object('reason', btrim(p_reason), 'from', t.status), 'assigned', 'searching', 'admin');
  UPDATE public.trips SET status = 'confirmed', rider_id = NULL, assigned_at = NULL, accepted_at = NULL, arriving_at = NULL WHERE id = t.id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_redispatch(p_trip_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.trips;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR t.status <> 'confirmed' OR t.rider_id IS NOT NULL THEN RAISE EXCEPTION 'Only rides still waiting for a rider can be re-dispatched'; END IF;
  UPDATE public.ride_offers SET response = 'cancelled', responded_at = now(), response_reason = 'Dispatch restarted by admin' WHERE trip_id = t.id AND response = 'pending';
  UPDATE public.trips SET dispatch_state = 'searching', dispatch_started_at = now(), escalated_at = NULL WHERE id = t.id;
  PERFORM public.log_dispatch(t.id, NULL, NULL, 'DISPATCH_RESTARTED', NULL, NULL, t.dispatch_state, 'searching', 'admin');
  PERFORM public.dispatch_trip(t.id);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_update_dispatch_settings(p_offer_timeout_seconds int, p_max_offers int, p_fairness_window_days int, p_escalate_after_seconds int, p_weights jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF p_offer_timeout_seconds NOT BETWEEN 20 AND 600 THEN RAISE EXCEPTION 'Offer timeout must be 20–600 seconds'; END IF;
  IF p_max_offers NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Maximum offers must be 1–20'; END IF;
  IF p_fairness_window_days NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Fairness window must be 1–30 days'; END IF;
  IF p_escalate_after_seconds NOT BETWEEN 60 AND 3600 THEN RAISE EXCEPTION 'Escalation wait must be 60–3600 seconds'; END IF;
  FOREACH k IN ARRAY ARRAY['base','completed_today','completed_window','offers_today','decline','timeout','withdrawal','no_show','idle_hour','offer_idle_hour'] LOOP
    IF jsonb_typeof(p_weights->k) IS DISTINCT FROM 'number' OR (p_weights->>k)::numeric < 0 OR (p_weights->>k)::numeric > 1000 THEN RAISE EXCEPTION 'Weight % must be a number between 0 and 1000', k; END IF;
  END LOOP;
  UPDATE public.dispatch_settings SET offer_timeout_seconds = p_offer_timeout_seconds, max_offers = p_max_offers, fairness_window_days = p_fairness_window_days,
    escalate_after_seconds = p_escalate_after_seconds, weights = p_weights, updated_at = now(), updated_by = auth.uid() WHERE id;
END; $$;

DROP FUNCTION public.admin_list_eligible_riders();
CREATE FUNCTION public.admin_list_eligible_riders() RETURNS TABLE(user_id uuid, full_name text, vehicle_description text, plate_number text, busy boolean,
  availability text, has_pending_offer boolean, fairness jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN QUERY SELECT a.user_id, a.full_name, a.vehicle_description, a.plate_number, public.rider_is_busy(a.user_id),
    public.rider_availability_of(a.user_id),
    EXISTS (SELECT 1 FROM public.ride_offers o WHERE o.rider_id = a.user_id AND o.response = 'pending'),
    public.rider_dispatch_score(a.user_id)
  FROM public.rider_applications a WHERE a.status = 'approved' AND public.has_role(a.user_id, 'rider') ORDER BY a.full_name;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_dispatch_overview() RETURNS TABLE(trip_id uuid, dispatch_state text, waiting_seconds int, offers_total int, offers_declined int,
  offers_timed_out int, offers_cancelled int, pending_rider_id uuid, pending_expires_at timestamptz, candidate_count int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  PERFORM public.dispatch_tick();
  RETURN QUERY SELECT t.id, t.dispatch_state, extract(epoch FROM now() - t.confirmed_at)::int,
    (SELECT count(*)::int FROM public.ride_offers o WHERE o.trip_id = t.id),
    (SELECT count(*)::int FROM public.ride_offers o WHERE o.trip_id = t.id AND o.response = 'declined'),
    (SELECT count(*)::int FROM public.ride_offers o WHERE o.trip_id = t.id AND o.response = 'timed_out'),
    (SELECT count(*)::int FROM public.ride_offers o WHERE o.trip_id = t.id AND o.response = 'cancelled'),
    (SELECT o.rider_id FROM public.ride_offers o WHERE o.trip_id = t.id AND o.response = 'pending'),
    (SELECT o.expires_at FROM public.ride_offers o WHERE o.trip_id = t.id AND o.response = 'pending'),
    CASE WHEN t.status = 'confirmed' AND t.rider_id IS NULL THEN (SELECT count(*)::int FROM public.dispatch_candidates(t.id)) ELSE NULL END
  FROM public.trips t WHERE NOT public.trip_is_terminal(t.status);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_trip_dispatch(p_trip_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN jsonb_build_object(
    'offers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'rider_id', o.rider_id,
        'rider_name', (SELECT a.full_name FROM public.rider_applications a WHERE a.user_id = o.rider_id ORDER BY a.created_at DESC LIMIT 1),
        'offered_at', o.offered_at, 'expires_at', o.expires_at, 'responded_at', o.responded_at, 'response', o.response,
        'response_reason', o.response_reason, 'score', o.dispatch_score, 'reason', o.dispatch_reason) ORDER BY o.offered_at)
      FROM public.ride_offers o WHERE o.trip_id = p_trip_id), '[]'::jsonb),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'rider_id', e.rider_id,
        'rider_name', (SELECT a.full_name FROM public.rider_applications a WHERE a.user_id = e.rider_id ORDER BY a.created_at DESC LIMIT 1),
        'score', e.dispatch_score, 'reason', e.reason, 'from_state', e.from_state, 'to_state', e.to_state, 'actor_role', e.actor_role, 'created_at', e.created_at) ORDER BY e.created_at)
      FROM public.dispatch_events e WHERE e.trip_id = p_trip_id), '[]'::jsonb),
    'candidates', coalesce((SELECT jsonb_agg(jsonb_build_object('rider_id', c.rider_id,
        'rider_name', (SELECT a.full_name FROM public.rider_applications a WHERE a.user_id = c.rider_id ORDER BY a.created_at DESC LIMIT 1),
        'score', c.score, 'breakdown', c.breakdown))
      FROM (SELECT * FROM public.dispatch_candidates(p_trip_id) LIMIT 10) c), '[]'::jsonb));
END; $$;

-- ============ Student group view: add dispatch state ============
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
        'dispatch_state', t.dispatch_state, 'confirmed_at', t.confirmed_at,
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
