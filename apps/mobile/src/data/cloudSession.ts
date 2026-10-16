/**
 * Cloud AI seams. Both are inert until the backend exists:
 *
 * - `getAccessToken` returns null, so the proxy client reports "no session" and every question
 *   is answered by the rules on this phone.
 * - the endpoint comes from build-time config only. Nothing is hard-coded.
 *
 * TODO(backend): when the claude-proxy is deployed, return the anonymous session's access token
 * here (Supabase auth lives behind this one function; nothing else in the app should import it).
 */
export async function getAccessToken(): Promise<string | null> {
  return null;
}

/** Proxy URL from build-time config (`EXPO_PUBLIC_CLAUDE_PROXY_URL`), or null when unset. */
export function cloudEndpoint(): string | null {
  const url = process.env.EXPO_PUBLIC_CLAUDE_PROXY_URL;
  return typeof url === 'string' && url.trim() !== '' ? url.trim() : null;
}
