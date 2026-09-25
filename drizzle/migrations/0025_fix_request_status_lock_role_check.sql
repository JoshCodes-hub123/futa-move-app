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
  -- This trigger runs as its owner, so check the caller's API role (from the request token), not current_user.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(auth.role(), '') IN ('authenticated','anon')
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