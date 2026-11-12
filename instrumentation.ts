// Runs once when the Next.js server starts, before it handles requests.
export async function register() {
  const { trimEnv } = await import("./lib/env");
  trimEnv();
}
