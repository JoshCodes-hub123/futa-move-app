CREATE TYPE public.location_category AS ENUM ('GATE', 'ACADEMIC', 'HOSTEL');

CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  official_name text,
  category public.location_category NOT NULL,
  location_type text NOT NULL,
  description text,
  latitude double precision,
  longitude double precision,
  google_place_id text,
  image_url text,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT locations_type_valid CHECK (location_type IN ('gate','school','academic_building','library','health_centre','student_union','hostel')),
  CONSTRAINT locations_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT locations_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT locations_coords_pair CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE UNIQUE INDEX locations_name_unique ON public.locations (lower(trim(name)));
CREATE INDEX locations_active_order ON public.locations (active, category, display_order);

GRANT SELECT, INSERT, UPDATE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students read active locations" ON public.locations FOR SELECT TO authenticated
  USING (active OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins create locations" ON public.locations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update locations" ON public.locations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER locations_set_updated_at BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.locations (name, category, location_type, display_order) VALUES
 ('North Gate','GATE','gate',10),('South Gate','GATE','gate',20),('West Gate','GATE','gate',30),
 ('SAAT','ACADEMIC','school',10),('SET','ACADEMIC','school',20),('SLS','ACADEMIC','school',30),
 ('SEMS','ACADEMIC','school',40),('SBMS','ACADEMIC','school',50),('SOC','ACADEMIC','school',60),
 ('SLIT','ACADEMIC','school',70),('SPS','ACADEMIC','school',80),('SIMME','ACADEMIC','school',90),
 ('SESE','ACADEMIC','school',100),('Engineering Complex','ACADEMIC','academic_building',110),
 ('ICT Centre','ACADEMIC','academic_building',120),('Senate Building','ACADEMIC','academic_building',130),
 ('FUTA Library','ACADEMIC','library',140),('SUB','ACADEMIC','student_union',150),
 ('Health Centre','ACADEMIC','health_centre',160),
 ('Adeniyi Hostel','HOSTEL','hostel',10),('Jadesola Hostel','HOSTEL','hostel',20),('Awosika Hostel','HOSTEL','hostel',30),
 ('Adeboye Hostel','HOSTEL','hostel',40),('Jibowu Hostel','HOSTEL','hostel',50),('Jibowu Annex 3','HOSTEL','hostel',60),
 ('Abiola Hostel','HOSTEL','hostel',70),('Adesida Hostel','HOSTEL','hostel',80),('Akindeko Hostel','HOSTEL','hostel',90),
 ('Bisibalogun Hostel','HOSTEL','hostel',100),('CMS Hostel','HOSTEL','hostel',110),('Postgraduate Hostel','HOSTEL','hostel',120);

-- Ride requests reference locations; text columns remain as the historical snapshot.
ALTER TABLE public.ride_requests
  ADD COLUMN origin_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  ADD COLUMN destination_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT;
CREATE INDEX ride_requests_origin_loc ON public.ride_requests (origin_location_id);
CREATE INDEX ride_requests_destination_loc ON public.ride_requests (destination_location_id);

CREATE OR REPLACE FUNCTION public.ride_requests_location_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE o public.locations; d public.locations;
BEGIN
  IF NEW.origin_location_id IS NOT NULL AND NEW.origin_location_id = NEW.destination_location_id THEN
    RAISE EXCEPTION 'Current location and destination must be different';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.origin_location_id IS DISTINCT FROM OLD.origin_location_id THEN
    IF NEW.origin_location_id IS NOT NULL THEN
      SELECT * INTO o FROM public.locations WHERE id = NEW.origin_location_id;
      IF NOT FOUND OR NOT o.active THEN RAISE EXCEPTION 'Choose an active FUTAMOVE location'; END IF;
      NEW.origin_text := o.name; NEW.origin_point_id := o.id::text;
      NEW.origin_latitude := o.latitude; NEW.origin_longitude := o.longitude;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.destination_location_id IS DISTINCT FROM OLD.destination_location_id THEN
    IF NEW.destination_location_id IS NOT NULL THEN
      SELECT * INTO d FROM public.locations WHERE id = NEW.destination_location_id;
      IF NOT FOUND OR NOT d.active THEN RAISE EXCEPTION 'Choose an active FUTAMOVE location'; END IF;
      NEW.destination_text := d.name; NEW.destination_point_id := d.id::text;
      NEW.destination_latitude := d.latitude; NEW.destination_longitude := d.longitude;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ride_requests_location_guard BEFORE INSERT OR UPDATE ON public.ride_requests
  FOR EACH ROW EXECUTE FUNCTION public.ride_requests_location_guard();

-- Matching compares location identity first (via point ids = location ids), then legacy fallback.
CREATE OR REPLACE FUNCTION public.requests_compatible(a ride_requests, b ride_requests)
 RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT a.ride_type = 'shared' AND b.ride_type = 'shared'
    AND public.places_compatible(coalesce(a.destination_location_id::text, a.destination_point_id), a.destination_text, a.destination_latitude, a.destination_longitude,
                                 coalesce(b.destination_location_id::text, b.destination_point_id), b.destination_text, b.destination_latitude, b.destination_longitude, public.dropoff_radius_m())
    AND public.places_compatible(coalesce(a.origin_location_id::text, a.origin_point_id), a.origin_text, a.origin_latitude, a.origin_longitude,
                                 coalesce(b.origin_location_id::text, b.origin_point_id), b.origin_text, b.origin_latitude, b.origin_longitude, public.pickup_radius_m())
    AND abs(extract(epoch FROM (a.departure_time - b.departure_time))) <= extract(epoch FROM public.match_time_tolerance())
$$;

-- Location images: private bucket, any signed-in user can view, admins manage.
CREATE POLICY "Signed-in users view location images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'location-images');
CREATE POLICY "Admins upload location images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'location-images' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update location images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'location-images' AND public.has_role(auth.uid(), 'admin'));