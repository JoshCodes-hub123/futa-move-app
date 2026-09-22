export type RideState = "current" | "upcoming" | "complete";
export interface RideSummary { id: string; from: string; to: string; time: string; state: RideState }

export const upcomingRide: RideSummary = {
  id: "ride-preview-01",
  from: "FUTA Main Gate",
  to: "South Gate",
  time: "Today, 4:30 PM",
  state: "upcoming",
};

export const recentRide: RideSummary = {
  id: "ride-preview-02",
  from: "Obanla Campus",
  to: "North Gate",
  time: "Monday, 2:15 PM",
  state: "complete",
};