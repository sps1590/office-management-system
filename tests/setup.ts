import { afterEach } from "vitest";
import { loadTestEnv } from "./helpers/env";
import { signOut } from "./helpers/world";

// Runs in every worker, before that worker's test file. globalSetup has
// already applied the schema and run the interlock; this only has to point
// `getDb()` at the same branch.
loadTestEnv();

// A session left set by one test must not silently authorise the next.
afterEach(() => {
  signOut();
});
