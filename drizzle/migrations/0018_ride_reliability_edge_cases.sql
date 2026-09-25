-- 1. Stale offers: whenever a trip gets a rider or ends, any still-pending offer is cancelled (audited).
CREATE OR REPLACE FUNCTION public.trips_cancel_stale_offers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o record;
BEGIN
  IF NEW.rider_id IS NOT NULL OR public.trip_is_terminal(NEW.status) THEN
    FOR o IN SELECT id, rider_id FROM ride_offers WHERE trip_id = NEW.id AND response = 'pending' AND rider_id IS DISTINCT FROM NEW.rider_id LOOP
      UPDATE ride_offers SET response = 'cancelled', responded_at = now(),
        response_reason = CASE WHEN public.trip_is_terminal(NEW.status) THEN 'Ride ended' ELSE 'Another rider was assigned' END
      WHERE id = o.id;
      PERFORM log_dispatch(NEW.id, o.rider_id, o.id, 'OFFER_CANCELLED', NULL, jsonb_build_object('reason', CASE WHEN public.trip_is_terminal(NEW.status) THEN 'ride_ended' ELSE 'rider_assigned' END), NEW.dispatch_state, NEW.dispatch_state, 'system');
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trips_cancel_stale_offers AFTER UPDATE OF status, rider_id ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_cancel_stale_offers();

-- 2. Rider reports passengers didn't show (only after arriving, 5+ min wait, nobody confirmed pickup).
CREATE OR REPLACE FUNCTION public.rider_report_passenger_no_show(p_trip_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t trips; uid uuid := auth.uid(); r text;
BEGIN
  IF NOT rider_is_eligible(uid) THEN RAISE EXCEPTION 'Only approved riders can update rides'; END IF;
  SELECT * INTO t FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR t.rider_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'This ride is not assigned to you'; END IF;
  IF t.status <> 'picked_up' THEN RAISE EXCEPTION 'You can report a no-show only after you have arrived at the meeting point'; END IF;
  IF EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id = t.id AND role = 'passenger' AND confirmation_type = 'pickup_start') THEN
    RAISE EXCEPTION 'A passenger already confirmed they are in the keke';
  END IF;
  IF t.arrived_at IS NULL OR t.arrived_at > now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'Please wait at least 5 minutes at the meeting point before reporting a no-show';
  END IF;
  r := coalesce(nullif(left(btrim(coalesce(p_reason,'')), 300), ''), 'Passengers did not show at the meeting point');
  UPDATE trips SET status = 'no_show', cancelled_at = now(), cancelled_by = uid, cancelled_by_role = 'rider',
    cancel_reason = 'Passenger no-show: ' || r, cancelled_from_status = t.status WHERE id = t.id;
  UPDATE ride_groups SET status = 'cancelled' WHERE id = t.group_id;
  PERFORM log_trip_status(t.id, t.status, 'no_show', 'rider', 'Passenger no-show: ' || r);
  PERFORM log_dispatch(t.id, uid, NULL, 'PASSENGER_NO_SHOW', NULL, jsonb_build_object('reason', r), 'assigned', 'closed', 'rider');
END $$;

-- 3. Passenger reports the rider hasn't come: recorded and flagged to admins, never auto-applied.
CREATE OR REPLACE FUNCTION public.passenger_report_rider_late(p_trip_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t trips; uid uuid := auth.uid();
BEGIN
  SELECT * INTO t FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR uid IS NULL OR uid = t.rider_id OR NOT is_group_member(t.group_id, uid) THEN RAISE EXCEPTION 'You are not a passenger on this ride'; END IF;
  IF t.status NOT IN ('assigned','accepted','arriving') OR t.rider_id IS NULL THEN RAISE EXCEPTION 'You can report this only while waiting for your rider to arrive'; END IF;
  IF now() < t.departure_time + interval '10 minutes' THEN RAISE EXCEPTION 'You can report this from 10 minutes after the departure time'; END IF;
  IF EXISTS (SELECT 1 FROM dispatch_events WHERE trip_id = t.id AND event_type = 'RIDER_LATE_REPORTED' AND actor_id = uid AND rider_id = t.rider_id) THEN
    RAISE EXCEPTION 'You already reported this. FUTAMOVE support has been notified';
  END IF;
  PERFORM log_dispatch(t.id, t.rider_id, NULL, 'RIDER_LATE_REPORTED', NULL,
    jsonb_build_object('reason', nullif(left(btrim(coalesce(p_reason,'')), 300), ''), 'status', t.status), t.dispatch_state, t.dispatch_state, 'student');
END $$;

-- 4. Admin resolves a ride stuck after the rider marked destination arrival.
CREATE OR REPLACE FUNCTION public.admin_complete_trip(p_trip_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t trips;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO t FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF t.status <> 'in_progress' THEN RAISE EXCEPTION 'Only a ride in progress can be completed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM trip_confirmations WHERE trip_id = t.id AND confirmation_type = 'destination_arrival') THEN
    RAISE EXCEPTION 'The rider has not marked arrival at the destination yet';
  END IF;
  UPDATE trips SET status = 'completed', completed_at = now() WHERE id = t.id;
  UPDATE ride_groups SET status = 'completed' WHERE id = t.group_id;
  PERFORM log_trip_status(t.id, 'in_progress', 'completed', 'admin', 'Admin completed the ride: ' || btrim(p_reason));
  PERFORM log_dispatch(t.id, t.rider_id, NULL, 'ADMIN_COMPLETED', NULL, jsonb_build_object('reason', btrim(p_reason)), 'assigned', 'closed', 'admin');
END $$;

-- 5. Admin-only list of genuinely abnormal rides (read-only; nothing changes automatically).
CREATE OR REPLACE FUNCTION public.admin_trip_issues()
RETURNS TABLE(trip_id uuid, issue text, since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN QUERY
  SELECT e.trip_id, 'rider_late_reported'::text, max(e.created_at) FROM dispatch_events e JOIN trips t ON t.id = e.trip_id
    WHERE e.event_type = 'RIDER_LATE_REPORTED' AND e.rider_id = t.rider_id AND t.status IN ('assigned','accepted','arriving') GROUP BY e.trip_id
  UNION ALL
  SELECT t.id, 'assignment_unanswered', t.assigned_at FROM trips t WHERE t.status = 'assigned' AND t.assigned_at < now() - interval '10 minutes'
  UNION ALL
  SELECT t.id, 'rider_late', t.departure_time FROM trips t WHERE t.status IN ('accepted','arriving') AND t.departure_time < now() - interval '15 minutes'
  UNION ALL
  SELECT t.id, 'start_not_confirmed', t.arrived_at FROM trips t WHERE t.status = 'picked_up' AND t.arrived_at < now() - interval '15 minutes'
  UNION ALL
  SELECT t.id, 'completion_not_confirmed', c.created_at FROM trips t JOIN trip_confirmations c ON c.trip_id = t.id AND c.confirmation_type = 'destination_arrival'
    WHERE t.status = 'in_progress' AND c.created_at < now() - interval '15 minutes';
END $$;

REVOKE ALL ON FUNCTION public.rider_report_passenger_no_show(uuid, text), public.passenger_report_rider_late(uuid, text), public.admin_complete_trip(uuid, text), public.admin_trip_issues() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rider_report_passenger_no_show(uuid, text), public.passenger_report_rider_late(uuid, text), public.admin_complete_trip(uuid, text), public.admin_trip_issues() TO authenticated;