// Default preferences. Edited in the app's Settings > Preferences screen (stored in
// Blobs). Only things the athlete chooses live here; anything measurable comes from data.
import type { Settings } from "../../../shared/schemas";

// Account 1's starting point, from what she described when the project started.
export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  name: "Tatiana",
  races: [],
  schedule: {
    Monday: { minutes: 60, usual: "pool" },
    Tuesday: { minutes: 60, usual: "indoor_trainer" },
    Wednesday: { minutes: 60, usual: "pool" },
    Thursday: { minutes: 75, usual: "run" },
    Friday: { minutes: 60, usual: "pool" },
    Saturday: { minutes: 120, usual: "outdoor_bike" },
    Sunday: { minutes: 90, usual: "run" },
  },
  fixed_sessions: [{ weekday: "Thursday", time: "17:00", sport: "run", description: "Group run, 5 to 10 km, picks the pace group" }],
  this_week: null,
  finished: ["sprint", "olympic", "70.3"],
  equipment: { smart_trainer: true, outdoor_power_meter: false, chest_hr_strap: false },
  long_ride_day: null,
  long_run_day: null,
  max_sessions: { swim: 3, bike: null, run: null },
  strength: false,
  max_hard_per_week: 2,
  phase: "base",
  one_sided_breathing: true,
  returning_from_injury: false,
  coach_note: "Swim limiters: breathing and short, rushed strokes. Long-term swim goal 1:40/100m. University student, so weekday time is limited.",
  run_targets: "hr",
};

// Starting point for any other account: fill it in on the Preferences screen.
export const BLANK_SETTINGS: Settings = {
  version: 2,
  name: "",
  races: [],
  schedule: {
    Monday: { minutes: 60, usual: null },
    Tuesday: { minutes: 60, usual: null },
    Wednesday: { minutes: 60, usual: null },
    Thursday: { minutes: 60, usual: null },
    Friday: { minutes: 0, usual: null },
    Saturday: { minutes: 90, usual: null },
    Sunday: { minutes: 90, usual: null },
  },
  fixed_sessions: [],
  this_week: null,
  finished: [],
  equipment: { smart_trainer: false, outdoor_power_meter: false, chest_hr_strap: false },
  long_ride_day: null,
  long_run_day: null,
  max_sessions: { swim: null, bike: null, run: null },
  strength: false,
  max_hard_per_week: 2,
  phase: "base",
  one_sided_breathing: false,
  returning_from_injury: false,
  coach_note: "",
  run_targets: "hr",
};
