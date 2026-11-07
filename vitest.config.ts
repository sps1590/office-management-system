import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/*
   The suite runs the product's real `src/lib` modules against a real Neon
   branch -- the only kind of test that would have caught the four defects of
   2026-11-07, every one of which had already been "verified" by reading code.

   Three things have to be replaced for a Server Action to run outside a
   request, and all three are replaced with the smallest possible stand-in
   rather than a mock of the behaviour under test:

   - `server-only` throws on import outside React's server runtime. Empty.
   - `next/headers` is the session cookie and the request headers, which is
     how `requireUser()` learns who is asking. The stub holds one session id
     that a test sets; everything behind it -- the sessions table, the role
     matrix, the tenant lookup -- is the real code.
   - `next/navigation`'s `redirect()` is how `requirePermission()` refuses,
     and it works by throwing. The stub throws something a test can assert on.

   No database call is stubbed. Nothing in `src/` is stubbed.
*/
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: here("./src/") },
      { find: /^server-only$/, replacement: here("./tests/stubs/server-only.ts") },
      { find: /^next\/headers$/, replacement: here("./tests/stubs/next-headers.ts") },
      { find: /^next\/cache$/, replacement: here("./tests/stubs/next-cache.ts") },
      { find: /^next\/navigation$/, replacement: here("./tests/stubs/next-navigation.ts") },
      { find: /^next\/dynamic$/, replacement: here("./tests/stubs/next-dynamic.tsx") },
    ],
  },
  test: {
    environment: "node",
    globalSetup: [here("./tests/globalSetup.ts")],
    setupFiles: [here("./tests/setup.ts")],
    include: ["tests/**/*.test.{ts,tsx}"],
    /*
       One Neon branch, shared. Files run one at a time: the schema is applied
       once in globalSetup rather than raced for by several workers, and a
       0.25 CU test compute is not made faster by piling concurrent HTTP
       statements onto it.
    */
    fileParallelism: false,
    // Every assertion is a round trip to Singapore, and provisioning a tenant
    // is a handful of them.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: ["default"],
  },
});
