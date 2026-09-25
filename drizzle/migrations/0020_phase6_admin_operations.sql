CREATE OR REPLACE FUNCTION public.admin_ops_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  SELECT jsonb_build_object(
    'active_rides', (SELECT count(*) FROM trips WHERE status IN ('confirmed','assigned','accepted','arriving','picked_up','in_progress')),
    'waiting_for_rider', (SELECT count(*) FROM trips WHERE status = 'confirmed' AND rider_id IS NULL),
    'in_progress', (SELECT count(*) FROM trips WHERE status IN ('picked_up','in_progress')),
    'needs_action', (SELECT count(DISTINCT x.trip_id) FROM (
        SELECT i.trip_id FROM admin_trip_issues() i
        UNION SELECT id FROM trips WHERE status = 'confirmed' AND rider_id IS NULL AND dispatch_state = 'escalated') x),
    'pending_student_verifications', (SELECT count(*) FROM verification_submissions WHERE status = 'pending' AND account_type = 'student'),
    'pending_lecturer_verifications', (SELECT count(*) FROM verification_submissions WHERE status = 'pending' AND account_type = 'lecturer'),
    'pending_rider_applications', (SELECT count(*) FROM rider_applications WHERE status = 'pending'),
    'approved_riders', (SELECT count(*) FROM rider_applications WHERE status = 'approved'),
    'online_riders', (SELECT count(*) FROM rider_applications a JOIN rider_availability v ON v.rider_id = a.user_id WHERE a.status = 'approved' AND v.status = 'online'),
    'busy_riders', (SELECT count(*) FROM rider_applications a JOIN rider_availability v ON v.rider_id = a.user_id WHERE a.status = 'approved' AND v.status = 'busy'),
    'pending_location_suggestions', (SELECT count(*) FROM location_suggestions WHERE status = 'pending'),
    'requests_total', (SELECT count(*) FROM ride_requests WHERE status <> 'draft'),
    'requests_today', (SELECT count(*) FROM ride_requests WHERE status <> 'draft' AND created_at >= date_trunc('day', now())),
    'completed_total', (SELECT count(*) FROM trips WHERE status = 'completed'),
    'completed_today', (SELECT count(*) FROM trips WHERE status = 'completed' AND completed_at >= date_trunc('day', now())),
    'cancelled_total', (SELECT count(*) FROM trips WHERE status IN ('cancelled_by_student','cancelled_by_rider','cancelled_by_admin','expired')),
    'no_show_total', (SELECT count(*) FROM trips WHERE status = 'no_show')
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_rider_pool()
RETURNS TABLE(user_id uuid, availability text, location_updated_at timestamptz, current_trip_id uuid, current_trip_status text, current_trip_route text, completed_rides integer, rating_avg numeric, rating_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN QUERY
  SELECT a.user_id,
    coalesce(v.status, 'offline'),
    v.location_at,
    ct.id, ct.status, CASE WHEN ct.id IS NULL THEN NULL ELSE ct.meeting_point_text || ' → ' || ct.destination_text END,
    (SELECT count(*)::int FROM trips t WHERE t.rider_id = a.user_id AND t.status = 'completed'),
    (SELECT round(avg(rr.stars)::numeric, 1) FROM rider_ratings rr WHERE rr.rider_id = a.user_id),
    (SELECT count(*)::int FROM rider_ratings rr WHERE rr.rider_id = a.user_id)
  FROM rider_applications a
  LEFT JOIN rider_availability v ON v.rider_id = a.user_id
  LEFT JOIN LATERAL (SELECT t.* FROM trips t WHERE t.rider_id = a.user_id AND t.status IN ('assigned','accepted','arriving','picked_up','in_progress') ORDER BY t.updated_at DESC LIMIT 1) ct ON true;
END $$;

CREATE OR REPLACE FUNCTION public.admin_trip_passengers()
RETURNS TABLE(trip_id uuid, passenger_names text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN QUERY
  SELECT t.id, string_agg(coalesce(p.full_name, 'Unnamed'), ', ' ORDER BY m.joined_at)
  FROM trips t JOIN ride_group_members m ON m.group_id = t.group_id
  LEFT JOIN student_profiles p ON p.id = m.student_id
  WHERE t.created_at > now() - interval '60 days'
  GROUP BY t.id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_audit_log(p_limit integer DEFAULT 100)
RETURNS TABLE(at timestamptz, actor_email text, action text, target text, reason text, trip_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Administrators only'; END IF;
  RETURN QUERY
  SELECT x.at, u.email::text, x.action, x.target, x.reason, x.trip_id FROM (
    SELECT h.created_at at, h.actor_id actor, 'Ride ' || coalesce(h.from_status,'created') || ' → ' || h.to_status action,
           t.meeting_point_text || ' → ' || t.destination_text target, h.reason, h.trip_id
      FROM trip_status_history h JOIN trips t ON t.id = h.trip_id WHERE h.actor_role = 'admin'
    UNION ALL
    SELECT e.created_at, e.actor_id, 'Dispatch: ' || e.event_type, t.meeting_point_text || ' → ' || t.destination_text,
           coalesce(e.reason->>'why', e.reason->>'reason'), e.trip_id
      FROM dispatch_events e JOIN trips t ON t.id = e.trip_id WHERE e.actor_role = 'admin'
    UNION ALL
    SELECT s.reviewed_at, s.reviewed_by, initcap(s.account_type) || ' verification ' || s.status::text, s.full_name, s.rejection_reason, NULL
      FROM verification_submissions s WHERE s.reviewed_at IS NOT NULL
    UNION ALL
    SELECT r.reviewed_at, r.reviewed_by, 'Rider application ' || r.status::text, r.full_name, r.rejection_reason, NULL
      FROM rider_applications r WHERE r.reviewed_at IS NOT NULL
    UNION ALL
    SELECT l.reviewed_at, l.reviewed_by, 'Location suggestion ' || l.status::text, l.name, l.rejection_reason, NULL
      FROM location_suggestions l WHERE l.reviewed_at IS NOT NULL
  ) x LEFT JOIN auth.users u ON u.id = x.actor
  ORDER BY x.at DESC LIMIT least(greatest(coalesce(p_limit,100),1),300);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_ops_overview(), public.admin_rider_pool(), public.admin_trip_passengers(), public.admin_audit_log(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ops_overview(), public.admin_rider_pool(), public.admin_trip_passengers(), public.admin_audit_log(integer) TO authenticated;