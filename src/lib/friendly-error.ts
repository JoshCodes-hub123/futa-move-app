/**
 * Turns backend error text into wording ordinary FUTA students/staff understand.
 * Our database functions already raise plain-English messages; those pass through.
 * Anything that looks technical (SQL, constraint names, network internals) is replaced.
 */
const TECHNICAL = /(violates|duplicate key|constraint|relation "|column "|function .*does not exist|syntax error|jwt|pgrst|schema cache|null value|invalid input syntax|uuid|sqlstate|\b(22|23|42|P0)\d{3}\b|stack|undefined|TypeError)/i;

export function friendlyMessage(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (!m) return "Something went wrong. Please try again.";
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(m)) return "We couldn't reach FUTAMOVE. Check your internet connection and try again.";
  if (/NOT_AUTHORIZED_TO_CHANGE_TRIP_STATUS|permission denied|row-level security|not authori[sz]ed/i.test(m)) return "You're not allowed to do that. Refresh the page and use the buttons on this screen.";
  if (/jwt expired|invalid token|refresh token/i.test(m)) return "Your session has expired. Please sign in again.";
  if (/duplicate key|already exists/i.test(m)) return "This has already been done. Refresh the page to see the latest.";
  if (TECHNICAL.test(m)) return "Something went wrong. Please refresh the page and try again.";
  return m;
}
