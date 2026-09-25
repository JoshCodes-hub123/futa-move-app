-- lovable-cron-fallback-reviewed: offer expiry is purely time-based with no row change to react to; user required 15-30s server-side dispatch independent of open screens
CREATE OR REPLACE FUNCTION public.ride_requests_group_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ts text;
BEGIN
  IF coalesce(current_setting('futamove.internal', true), '') = '1' THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND OLD.group_id IS NOT NULL THEN
    SELECT status INTO ts FROM public.trips WHERE group_id = OLD.group_id;
    IF ts IN ('arriving','picked_up','in_progress') OR public.trip_is_terminal(coalesce(ts, 'confirmed')) THEN
      RAISE EXCEPTION 'RIDE_CANNOT_BE_CANCELLED: This ride is already % and can no longer be cancelled.', replace(ts, '_', ' ');
    END IF;
    NEW.group_id := NULL;
    PERFORM public.release_request_from_group(OLD.id, OLD.group_id);
    RETURN NEW;
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'RIDE_CANNOT_BE_CANCELLED: A cancelled request cannot be reopened.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND current_user NOT IN ('service_role','postgres','supabase_admin')
     AND NOT (NEW.status = 'cancelled')
     AND NOT (OLD.status = 'draft' AND NEW.status = 'searching' AND OLD.group_id IS NULL) THEN
    RAISE EXCEPTION 'REQUEST_STATUS_LOCKED: This ride request status can only change through FUTAMOVE.';
  END IF;
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'Group membership can only change through matching';
  END IF;
  IF OLD.group_id IS NOT NULL AND NEW.group_id IS NOT NULL AND (
       NEW.party_size <> OLD.party_size OR NEW.ride_type <> OLD.ride_type
    OR NEW.destination_text <> OLD.destination_text OR NEW.origin_text <> OLD.origin_text
    OR NEW.departure_time <> OLD.departure_time
    OR NEW.origin_location_id IS DISTINCT FROM OLD.origin_location_id
    OR NEW.destination_location_id IS DISTINCT FROM OLD.destination_location_id
    OR NEW.origin_point_id IS DISTINCT FROM OLD.origin_point_id
    OR NEW.destination_point_id IS DISTINCT FROM OLD.destination_point_id) THEN
    RAISE EXCEPTION 'Leave your group before changing this ride request';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_trip(p_trip_id uuid, p_outcome text, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  PERFORM set_config('futamove.internal', '1', true);
  UPDATE public.ride_requests SET status = 'cancelled' WHERE group_id = t.group_id AND status <> 'cancelled';
  PERFORM set_config('futamove.internal', '', true);
  PERFORM public.log_trip_status(t.id, t.status, p_outcome, 'admin', p_reason);
END; $function$;

GRANT EXECUTE ON FUNCTION public.ride_capacity() TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'futamove-dispatch-tick';
SELECT cron.schedule('futamove-dispatch-tick', '20 seconds', $$SELECT public.dispatch_tick();$$);