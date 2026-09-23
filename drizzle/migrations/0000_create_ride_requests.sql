CREATE TYPE public.ride_request_status AS ENUM ('draft', 'searching', 'cancelled');

CREATE TABLE public.ride_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL DEFAULT auth.uid(),
  origin_text text NOT NULL,
  origin_latitude double precision,
  origin_longitude double precision,
  destination_text text NOT NULL,
  destination_latitude double precision,
  destination_longitude double precision,
  departure_time timestamptz NOT NULL,
  status public.ride_request_status NOT NULL DEFAULT 'searching',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ride_requests_student_created_idx ON public.ride_requests (student_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.ride_requests TO authenticated;
GRANT ALL ON public.ride_requests TO service_role;

ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students read own ride requests"
  ON public.ride_requests FOR SELECT TO authenticated
  USING (auth.uid() = student_id);

CREATE POLICY "Students create own ride requests"
  ON public.ride_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Students update own ride requests"
  ON public.ride_requests FOR UPDATE TO authenticated
  USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ride_requests_set_updated_at
BEFORE UPDATE ON public.ride_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();