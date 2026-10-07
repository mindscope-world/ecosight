/** Proves who holds a sign-in token: their email address, or null when the token is no good. */
export type Verifier = (token: string) => Promise<{ email: string } | null>;

export interface User {
  id: string;
  email: string;
  role: 'viewer' | 'reviewer' | 'admin';
}

/** Longest a checked token is trusted without asking again. */
const REMEMBER_MS = 60_000;

/**
 * Checks tokens with the Supabase project that issued them, by asking it whose
 * token this is. That works whatever signing keys the project uses. Answers are
 * remembered for a minute, so a page's burst of requests is one check.
 */
export function supabaseVerifier(url: string, key: string): Verifier {
  const seen = new Map<string, { email: string | null; until: number }>();
  return async (token) => {
    const now = Date.now();
    const known = seen.get(token);
    if (known && known.until > now) return known.email ? { email: known.email } : null;
    let email: string | null = null;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
        headers: { authorization: `Bearer ${token}`, apikey: key },
      });
      if (res.ok) email = ((await res.json()) as { email?: string }).email?.toLowerCase() ?? null;
      else if (res.status >= 500) return null; // Not remembered: the service may be back in a moment.
    } catch {
      return null;
    }
    if (seen.size > 500) seen.clear();
    seen.set(token, { email, until: now + REMEMBER_MS });
    return email ? { email } : null;
  };
}

/** A name as the importers key it: plain letters and digits, joined by hyphens. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
