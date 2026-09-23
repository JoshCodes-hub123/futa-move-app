import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, Loader2, Navigation, Plus, XCircle } from "lucide-react";
import { AppShell } from "@/components/futamove/app-shell";
import { ConfirmationDialog } from "@/components/futamove/confirmation-dialog";
import { EmptyState, ErrorState, LoadingState, ScreenHeader, SectionHeading, TrustNote } from "@/components/futamove/primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RouteSummary } from "@/features/ride-request";
import {
  cancelRideRequest,
  formatDepartureTime,
  getRideRequest,
  listRideRequests,
  type RideRequest,
} from "@/services/ride-requests";

const rideRequestsKey = ["ride-requests"] as const;

function StatusPill({ status }: { status: RideRequest["status"] }) {
  const label = status === "searching" ? "Searching" : status === "cancelled" ? "Cancelled" : "Draft";
  const variant = status === "searching" ? "warning" : "outline";
  return (
    <Badge variant={variant} className="gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold">
      <span className={status === "searching" ? "size-1.5 animate-pulse rounded-full bg-warning" : "size-1.5 rounded-full bg-muted-foreground"} />
      {label}
    </Badge>
  );
}

function RequestRow({ request }: { request: RideRequest }) {
  return (
    <Link
      to="/student/rides/$id"
      params={{ id: request.id }}
      className="group flex items-center gap-4 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="min-w-0 flex-1">
        <p className="section-label mb-2">
          {request.status === "searching" ? "Searching for students" : request.status === "cancelled" ? "Cancelled request" : "Draft request"}
        </p>
        <p className="truncate text-sm font-semibold">{request.origin_text}</p>
        <p className="truncate text-sm font-semibold text-muted-foreground">↓ {request.destination_text}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{formatDepartureTime(request.departure_time)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusPill status={request.status} />
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

export function StudentRidesPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: rideRequestsKey, queryFn: listRideRequests });
  const active = (data ?? []).filter((r) => r.status === "searching");
  const past = (data ?? []).filter((r) => r.status !== "searching");

  return (
    <AppShell role="student">
      <ScreenHeader
        title="Rides"
        action={
          <Button asChild size="sm">
            <Link to="/student/request">
              <Plus /> New
            </Link>
          </Button>
        }
      />

      {isLoading && (
        <div className="mt-8">
          <LoadingState />
        </div>
      )}
      {isError && (
        <div className="mt-8">
          <ErrorState message="We couldn't load your ride requests. Check your connection and try again." />
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <section className="mt-9">
            <SectionHeading title="Active request" detail={active.length ? undefined : "None"} />
            {active.length ? (
              <div className="mt-2 divider-list">
                {active.map((request) => (
                  <RequestRow key={request.id} request={request} />
                ))}
              </div>
            ) : (
              <div className="surface-panel mt-3">
                <EmptyState
                  compact
                  icon={Navigation}
                  title="No active ride request"
                  description="Start a request and we'll look for students heading your way."
                  action={
                    <Button asChild>
                      <Link to="/student/request">Request a ride</Link>
                    </Button>
                  }
                />
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section className="mt-10">
              <SectionHeading title="Earlier requests" />
              <div className="mt-2 divider-list">
                {past.map((request) => (
                  <RequestRow key={request.id} request={request} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}

export function RideRequestDetailPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: [...rideRequestsKey, id],
    queryFn: () => getRideRequest(id),
  });

  const cancel = useMutation({
    mutationFn: () => cancelRideRequest(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: rideRequestsKey });
    },
  });

  return (
    <AppShell role="student">
      <div className="mx-auto w-full max-w-md lg:max-w-lg">
        <div className="flex h-11 items-center">
          <button
            type="button"
            aria-label="Go back"
            onClick={() => void navigate({ to: "/student/rides" })}
            className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowLeft className="size-[18px]" strokeWidth={1.75} />
          </button>
        </div>

        {isLoading && (
          <div className="mt-8">
            <LoadingState />
          </div>
        )}
        {isError && (
          <div className="mt-8">
            <ErrorState message="We couldn't load this ride request." />
          </div>
        )}
        {!isLoading && !isError && !data && (
          <div className="mt-8">
            <EmptyState title="Request not found" description="This ride request is no longer available." />
          </div>
        )}

        {data && (
          <section className="mt-8">
            {data.status === "searching" ? (
              <>
                <div className="flex justify-center py-4">
                  <span className="relative grid size-16 place-items-center">
                    <span className="absolute inset-0 animate-ping rounded-full bg-brand/25" />
                    <span className="absolute inset-2 rounded-full bg-brand/15" />
                    <Loader2 className="relative size-6 animate-spin text-brand-strong" strokeWidth={2} />
                  </span>
                </div>
                <h1 className="display-title mt-4 text-center text-[2rem]">Finding your people</h1>
                <p className="mx-auto mt-3 max-w-xs text-center text-sm leading-6 text-muted-foreground">
                  We're looking for verified FUTA students heading your way.
                </p>
              </>
            ) : (
              <>
                <h1 className="display-title text-[2rem]">Request cancelled</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  This ride request is no longer searching for students.
                </p>
              </>
            )}

            <div className="mt-8 flex justify-center">
              <StatusPill status={data.status} />
            </div>

            <div className="mt-6">
              <RouteSummary
                origin={data.origin_text}
                destination={data.destination_text}
                departure={data.departure_time}
              />
            </div>

            {cancel.isError && (
              <p className="mt-5 rounded-card border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
                We couldn't cancel this request. Check your connection and try again.
              </p>
            )}

            {data.status === "searching" && (
              <div className="mt-7">
                <ConfirmationDialog
                  trigger={
                    <Button variant="secondary" size="lg" className="w-full" disabled={cancel.isPending}>
                      {cancel.isPending ? <Loader2 className="animate-spin" /> : <XCircle />}
                      {cancel.isPending ? "Cancelling…" : "Cancel request"}
                    </Button>
                  }
                  title="Cancel this ride request?"
                  description="We'll stop looking for students heading your way. You can always create a new request."
                  confirmLabel="Cancel request"
                  onConfirm={() => cancel.mutate()}
                />
              </div>
            )}

            <div className="mt-7">
              <TrustNote>
                Student matching arrives in the next phase — your request is saved and waiting.
              </TrustNote>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
