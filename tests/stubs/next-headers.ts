/*
   Stands in for the request-scoped `cookies()` and `headers()` that
   `src/lib/auth.ts` and `src/lib/audit.ts` read.

   It holds exactly one thing: the id of the session the next action should
   run as. Everything that turns that id into a user -- the sessions row, the
   role join, the expanded permission matrix, the tenant's timezone -- is the
   product's own code, unmocked. `signInAs()` in tests/helpers/world.ts is
   what sets it.
*/

const SESSION_COOKIE = "oms_session";

let sessionId: string | null = null;

/** Who the next Server Action runs as. `null` means nobody is signed in. */
export function __setSessionCookie(id: string | null): void {
  sessionId = id;
}

export function __getSessionCookie(): string | null {
  return sessionId;
}

type StoredCookie = { name: string; value: string };

export async function cookies(): Promise<{
  get(name: string): StoredCookie | undefined;
  set(...args: unknown[]): void;
  delete(name: string): void;
}> {
  return {
    get: (name: string) =>
      name === SESSION_COOKIE && sessionId ? { name, value: sessionId } : undefined,
    // A Server Action under test may create or destroy a session (the login
    // and logout paths do). Writing the cookie through is what makes the
    // session it just created the one the next call sees.
    set: (...args: unknown[]) => {
      const [name, value] = args as [string, string];
      if (name === SESSION_COOKIE) sessionId = value;
    },
    delete: (name: string) => {
      if (name === SESSION_COOKIE) sessionId = null;
    },
  };
}

export async function headers(): Promise<Headers> {
  return new Headers({
    "user-agent": "vitest",
    "x-forwarded-for": "127.0.0.1",
  });
}
