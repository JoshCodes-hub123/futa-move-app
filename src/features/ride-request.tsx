import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Clock3,
  Loader2,
  LocateFixed,
  MapPin,
  Pencil,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/futamove/app-shell";
import { FieldError, ScreenHeader, TrustNote } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  FUTA_POINTS,
  createRideRequest,
  formatDepartureTime,
  roundedSuggestions,
  toLocalInputValue,
} from "@/services/ride-requests";

type Step = "route" | "time" | "review";

interface FieldErrors {
  origin?: string | undefined;
  destination?: string | undefined;
  time?: string | undefined;
  meetingPoint?: string | undefined;
}

interface Coords {
  latitude: number | null;
  longitude: number | null;
}

export function RideRequestPage({
  initialOrigin = "",
  initialDestination = "",
}: {
  initialOrigin?: string;
  initialDestination?: string;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("route");

  const [origin, setOrigin] = useState(initialOrigin);
  const [originCoords, setOriginCoords] = useState<Coords>({ latitude: null, longitude: null });
  const [destination, setDestination] = useState(initialDestination);
  const [meetingPoint, setMeetingPoint] = useState("");
  const [rideType, setRideType] = useState<"shared" | "private">("shared");
  const [partySize, setPartySize] = useState(1);
  const pointIdFor = (text: string) => FUTA_POINTS.find((p) => p.name.toLowerCase() === text.trim().toLowerCase())?.id ?? null;
  const [departure, setDeparture] = useState<string>(new Date().toISOString());
  const [useNow, setUseNow] = useState(true);

  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const suggestions = roundedSuggestions();

  function detectLocation() {
    setLocationNote(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationNote("Location isn't available on this device. Type your pickup point instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOriginCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setOrigin((current) => current.trim() || "My current location");
        setErrors((e) => ({ ...e, origin: undefined }));
        setLocationNote("Using your current location.");
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        setLocationNote(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Type your pickup point instead."
            : "We couldn't get your location. Type your pickup point instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function continueFromRoute() {
    const next: FieldErrors = {};
    if (!origin.trim()) next.origin = "Add your current location.";
    if (!destination.trim()) next.destination = "Add where you're going.";
    if (!meetingPoint.trim()) next.meetingPoint = "Suggest a meeting point for your group.";
    setErrors(next);
    if (Object.keys(next).length === 0) setStep("time");
  }

  function continueFromTime() {
    const value = useNow ? new Date().toISOString() : departure;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      setErrors((e) => ({ ...e, time: "Choose a valid departure time." }));
      return;
    }
    if (date.getTime() < Date.now() - 60_000) {
      setErrors((e) => ({ ...e, time: "Choose a time in the future." }));
      return;
    }
    setDeparture(date.toISOString());
    setErrors((e) => ({ ...e, time: undefined }));
    setStep("review");
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createRideRequest({
        originText: origin,
        originLatitude: originCoords.latitude,
        originLongitude: originCoords.longitude,
        destinationText: destination,
        departureTime: useNow ? new Date().toISOString() : departure,
        meetingPointText: meetingPoint,
        partySize,
        rideType,
        originPointId: originCoords.latitude === null ? pointIdFor(origin) : null,
        destinationPointId: pointIdFor(destination),
      });
      await navigate({ to: "/student/rides/$id", params: { id: created.id } });
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Something went wrong while creating your request. Check your connection and try again.",
      );
      setSubmitting(false);
    }
  }

  const stepIndex = step === "route" ? 1 : step === "time" ? 2 : 3;

  return (
    <AppShell role="student">
      <div className="mx-auto w-full max-w-md lg:max-w-lg">
        <div className="flex h-11 items-center justify-between">
          <button
            type="button"
            aria-label="Go back"
            onClick={() => {
              if (step === "route") void navigate({ to: "/student/home" });
              else setStep(step === "review" ? "time" : "route");
            }}
            className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowLeft className="size-[18px]" strokeWidth={1.75} />
          </button>
          <span className="section-label">Step {stepIndex} of 3</span>
        </div>

        {step === "route" && (
          <section className="mt-8">
            <ScreenHeader eyebrow="Ride request" title="Where are you going?" />
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Set your pickup point and destination around FUTA.
            </p>

            <div className="mt-7 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Ride type">
              {(["shared", "private"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={rideType === type}
                  onClick={() => setRideType(type)}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    rideType === type ? "border-brand bg-brand/10" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="block text-sm font-semibold">{type === "shared" ? "Shared ride" : "Private keke"}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {type === "shared" ? "Split with verified students" : "Just your party, no matching"}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-5">
              <p className="text-[0.8125rem] font-medium">How many people?</p>
              <div className="mt-2 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Party size">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={partySize === n}
                    onClick={() => setPartySize(n)}
                    className={cn(
                      "h-11 rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      partySize === n ? "border-brand bg-brand/10" : "border-border hover:bg-muted/50",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">A keke carries up to 4 passengers.</p>
            </div>

            <datalist id="futa-points">
              {FUTA_POINTS.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>

            <div className="surface-panel mt-7 p-2">
              <div className="relative">
                <div className="journey-line" />
                <RouteField
                  icon={LocateFixed}
                  id="origin"
                  label="Current location"
                  placeholder="e.g. FUTA North Gate"
                  list="futa-points"
                  value={origin}
                  invalid={Boolean(errors.origin)}
                  onChange={(value) => {
                    setOrigin(value);
                    setOriginCoords({ latitude: null, longitude: null });
                  }}
                />
                <div className="ml-14 h-px bg-border" />
                <RouteField
                  icon={MapPin}
                  id="destination"
                  label="Destination"
                  placeholder="e.g. Obanla"
                  list="futa-points"
                  value={destination}
                  invalid={Boolean(errors.destination)}
                  onChange={setDestination}
                />
              </div>
            </div>

            {errors.origin && <FieldError>{errors.origin}</FieldError>}
            {errors.destination && <FieldError>{errors.destination}</FieldError>}

            <div className="mt-6">
              <Label htmlFor="meeting-point" className="text-[0.8125rem] font-medium">
                Meeting point
              </Label>
              <Input
                id="meeting-point"
                className="mt-2"
                placeholder="e.g. SUB car park"
                value={meetingPoint}
                aria-invalid={errors.meetingPoint ? true : undefined}
                onChange={(event) => {
                  setMeetingPoint(event.target.value);
                  setErrors((e) => ({ ...e, meetingPoint: undefined }));
                }}
              />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Where your group should gather. Everyone in the group confirms it before moving on.
              </p>
              {errors.meetingPoint && <FieldError>{errors.meetingPoint}</FieldError>}
            </div>

            <Button variant="secondary" className="mt-4 w-full" onClick={detectLocation} disabled={locating}>
              {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
              {locating ? "Getting your location…" : "Use my current location"}
            </Button>
            {locationNote && <p className="mt-2 text-xs leading-5 text-muted-foreground">{locationNote}</p>}

            <Button size="lg" className="mt-7 w-full" onClick={continueFromRoute}>
              Continue
            </Button>
          </section>
        )}

        {step === "time" && (
          <section className="mt-8">
            <ScreenHeader eyebrow="Ride request" title="When are you leaving?" />
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Pick a time that suits your trip.</p>

            <div className="mt-7 grid gap-3">
              <TimeOption
                label="Now"
                detail="Leave as soon as students are found"
                active={useNow}
                onSelect={() => {
                  setUseNow(true);
                  setErrors((e) => ({ ...e, time: undefined }));
                }}
              />
              {suggestions.map((option) => {
                const active = !useNow && departure === option.iso;
                return (
                  <TimeOption
                    key={option.iso}
                    label={option.label}
                    detail={formatDepartureTime(option.iso)}
                    active={active}
                    onSelect={() => {
                      setUseNow(false);
                      setDeparture(option.iso);
                      setErrors((e) => ({ ...e, time: undefined }));
                    }}
                  />
                );
              })}
            </div>

            <div className="mt-7">
              <Label htmlFor="custom-time" className="text-[0.8125rem] font-medium">
                Or choose a custom time
              </Label>
              <Input
                id="custom-time"
                type="datetime-local"
                className="mt-2"
                value={useNow ? "" : toLocalInputValue(new Date(departure))}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  const date = new Date(value);
                  setUseNow(false);
                  setErrors((e) => ({ ...e, time: undefined }));
                  if (!Number.isNaN(date.getTime())) setDeparture(date.toISOString());
                }}
              />
              {errors.time && <FieldError>{errors.time}</FieldError>}
            </div>

            <Button size="lg" className="mt-7 w-full" onClick={continueFromTime}>
              Continue
            </Button>
          </section>
        )}

        {step === "review" && (
          <section className="mt-8">
            <ScreenHeader eyebrow="Ride request" title="Review your ride" />
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Check the details before we look for students heading your way.
            </p>

            <div className="mt-7">
              <RouteSummary
                origin={origin}
                destination={destination}
                departure={useNow ? new Date().toISOString() : departure}
                meetingPoint={meetingPoint}
              />
              <p className="mt-3 text-sm text-muted-foreground">
                {rideType === "shared" ? "Shared ride" : "Private keke"} · {partySize} {partySize === 1 ? "person" : "people"}
              </p>
            </div>

            {submitError && (
              <p className="mt-5 rounded-card border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
                {submitError}
              </p>
            )}

            <Button size="lg" className="mt-7 w-full" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Users />}
              {submitting ? "Creating your request…" : rideType === "shared" ? "Find students" : "Save request"}
            </Button>
            <Button variant="secondary" size="lg" className="mt-3 w-full" onClick={() => setStep("route")} disabled={submitting}>
              <Pencil /> Edit
            </Button>

            <div className="mt-7">
              <TrustNote>Only verified FUTA students can be matched with your ride.</TrustNote>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function RouteField({
  icon: Icon,
  id,
  label,
  placeholder,
  value,
  onChange,
  invalid,
  list,
}: {
  list?: string;
  icon: typeof MapPin;
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="relative z-10 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[0.875rem] px-3 py-3 transition-colors hover:bg-background/70"
    >
      <span className="grid size-9 place-items-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <Input
          id={id}
          aria-label={label}
          aria-invalid={invalid ? true : undefined}
          placeholder={placeholder}
          list={list}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 border-0 bg-transparent p-0 text-[0.9375rem] font-medium shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-0"
        />
      </span>
    </label>
  );
}

function TimeOption({
  label,
  detail,
  active,
  onSelect,
}: {
  label: string;
  detail: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "selection-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active ? "selection-card-active" : "hover:bg-muted/50",
      )}
    >
      <span className="grid size-10 place-items-center rounded-full bg-muted">
        <Clock3 className="size-5" strokeWidth={1.75} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span
        className={cn(
          "grid size-5 place-items-center rounded-full border transition-colors",
          active ? "border-brand bg-brand text-primary-foreground" : "border-border",
        )}
      >
        {active && <Check className="size-3" strokeWidth={3} />}
      </span>
    </button>
  );
}

export function RouteSummary({
  origin,
  destination,
  departure,
  meetingPoint,
}: {
  origin: string;
  destination: string;
  departure: string;
  meetingPoint?: string | null;
}) {
  return (
    <div className="surface-panel p-5">
      <div className="relative">
        <div className="journey-line" />
        <SummaryRow icon={LocateFixed} label="Current location" value={origin} />
        <div className="ml-14 h-px bg-border" />
        <SummaryRow icon={MapPin} label="Destination" value={destination} />
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
        <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
          <Clock3 className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0">
          <span className="block text-xs text-muted-foreground">Departure time</span>
          <span className="block text-sm font-semibold">{formatDepartureTime(departure)}</span>
        </span>
      </div>
      {meetingPoint ? (
        <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
          <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
            <Users className="size-[18px]" strokeWidth={1.75} />
          </span>
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">Meeting point</span>
            <span className="block truncate text-sm font-semibold">{meetingPoint}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="relative z-10 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-3">
      <span className="grid size-9 place-items-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block truncate text-[0.9375rem] font-semibold">{value}</span>
      </span>
    </div>
  );
}
