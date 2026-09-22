import type { RideSummary } from "./mock-data";

export interface RideRepository {
  listUpcoming(): Promise<RideSummary[]>;
  listRecent(): Promise<RideSummary[]>;
}

// Connect this boundary to Lovable Cloud when ride persistence is introduced.
export const rideRepository: RideRepository = {
  async listUpcoming() { return []; },
  async listRecent() { return []; },
};