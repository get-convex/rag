import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "deleteOldContent",
  { hours: 1 },
  internal.example.deleteOldContent,
  {}
);

export default crons;
