// Signing in by an emailed link, through the project's Supabase sign-in service.
// The link brings the reader back with a session in the address; it is kept in
// the browser and sent with each request. Whether the address is let in, and as
// what, is the API's decision, not this file's.

const AUTH_URL: string = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const AUTH_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const STORE = 'ecosight-session';

/** False in a build that was not given the sign-in service's address: only the access key works there. */
export const SIGN_IN_AVAILABLE = Boolean(AUTH_URL && AUTH_KEY);

interface Session {
  access_token: string;
  refresh_token: string;
  /** Seconds since 1970. */
  expires_at: number;
}

function read(): Session | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Session | null;
    return saved?.access_token && saved.refresh_token ? saved : null;
  } catch {
    return null;
  }
}

function write(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORE, JSON.stringify(session));
    else localStorage.removeItem(STORE);
  } catch {}
}

const headers = { apikey: AUTH_KEY, 'content-type': 'application/json' };

/** What went wrong with the link the reader arrived by, if anything, in the service's own words. */
export let signInProblem: string | null = null;

// A sign-in link returns with the session in the address, where share-link
// state normally is. It is taken out before any page reads the address.
(function takeSessionFromAddress() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = params.get('access_token');
  const refresh = params.get('refresh_token');
  const problem = params.get('error_description');
  if (!token && !problem) return;
  if (token && refresh)
    write({ access_token: token, refresh_token: refresh, expires_at: Math.floor(Date.now() / 1000) + Number(params.get('expires_in') ?? 3600) });
  else signInProblem = problem;
  history.replaceState(null, '', location.pathname + location.search);
})();

export const hasSession = () => read() !== null;

let refreshing: Promise<string | null> | null = null;

/** The token to send with a request, renewed first when it is about to run out. Null when not signed in. */
export async function bearer(): Promise<string | null> {
  const session = read();
  if (!session) return null;
  if (session.expires_at - Date.now() / 1000 > 60) return session.access_token;
  // Several requests at once share one renewal: a refresh token works once.
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
      write({ access_token: next.access_token, refresh_token: next.refresh_token, expires_at: Math.floor(Date.now() / 1000) + next.expires_in });
      return next.access_token;
    } catch {
      write(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Emails a sign-in link that returns to the page the reader is on. */
export async function requestLink(email: string): Promise<void> {
  const back = encodeURIComponent(location.origin + location.pathname);
  const res = await fetch(`${AUTH_URL}/auth/v1/otp?redirect_to=${back}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: email.trim(), create_user: true }),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { msg?: string; error_description?: string };
  throw new Error(
    res.status === 429
      ? 'Too many sign-in emails have been sent for now. Try again in an hour.'
      : (body.msg ?? body.error_description ?? 'The sign-in email could not be sent.'),
  );
}

export async function signOut(): Promise<void> {
  const session = read();
  write(null);
  if (session)
    await fetch(`${AUTH_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { ...headers, authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  location.reload();
}
