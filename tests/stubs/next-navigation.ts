/*
   `redirect()` is how the permission layer refuses: `requirePermission()`
   sends the caller to /dashboard rather than throwing a visible error. It
   works by throwing a special error that Next catches, so a test that wants
   to assert "this was refused" has to catch something. This throws a
   RedirectError carrying the destination.
*/

export class RedirectError extends Error {
  constructor(readonly destination: string) {
    super(`redirect(${destination})`);
    this.name = "RedirectError";
  }
}

export function redirect(destination: string): never {
  throw new RedirectError(destination);
}

export function permanentRedirect(destination: string): never {
  throw new RedirectError(destination);
}

export function notFound(): never {
  throw new RedirectError("/404");
}

/** `await expectRedirect(action(), "/dashboard")` — asserts the refusal. */
export async function expectRedirect(
  promise: Promise<unknown>,
  destination?: string
): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof RedirectError) {
      if (destination && err.destination !== destination) {
        throw new Error(
          `Expected a redirect to ${destination}, got ${err.destination}`
        );
      }
      return err.destination;
    }
    throw err;
  }
  throw new Error(
    `Expected a redirect${destination ? ` to ${destination}` : ""}, but the call returned normally`
  );
}
