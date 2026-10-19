// Default athlete profile and plan settings. Edited in the app's Settings screen
// (stored in Blobs), so changing them does not need a redeploy.
import type { Settings } from "../../../shared/schemas";

export const DEFAULT_SETTINGS: Settings = {
  profile: {
    name: "Tatiana",
    history:
      "Has finished a half Ironman (70.3), an Olympic and a sprint triathlon.",
    swim:
      "25 m pool, usually Mon/Wed/Fri, 2 to 3 times per week. Can swim 2000 m continuously. " +
      "Aerobic pace about 2:10/100m; long-term goal 1:40/100m. Limiters: breathing and short, rushed strokes. " +
      "Breathes to one side (after 2 strokes, then after 4) and wants to keep it: do NOT prescribe bilateral breathing drills. " +
      "Likes intervals, drills, and 1 to 2 main endurance sets.",
    bike: "Indoor on a Tacx Flux S smart trainer with MyWhoosh; also rides outdoors.",
    run: "Fixed group run Thursdays 17:00 (5 to 10 km, picks the pace group); treat it as a set session.",
    life: "University student, so time on weekdays is limited.",
    other_notes: "",
  },
  plan: {
    goal_race: "",
    goal_race_date: "",
    ftp_watts: null,
    threshold_run_pace: "",
    swim_css: "",
    max_hard_per_week: 2,
    usual_swim_days: ["Monday", "Wednesday", "Friday"],
    set_sessions: [
      {
        weekday: "Thursday",
        time: "17:00",
        sport: "run",
        description: "Group run, 5 to 10 km, athlete picks the pace group",
      },
    ],
    focus: "",
  },
};
