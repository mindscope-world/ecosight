import { useEffect, useRef, useState } from 'react';
import { fetchMe, type Me } from '../api';
import { hasSession, requestLink, SIGN_IN_AVAILABLE, signInProblem, signOut } from '../auth';
import { pageUrl } from '../pages';
import { Icon, MicroLabel } from './ui';

/** Who the API takes the reader to be; null until it has answered, or if it would not. */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((answer) => alive && setMe(answer))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return me;
}

export const canReview = (me: Me | null) => me?.role === 'reviewer' || me?.role === 'admin';

/** Asks for an email address and sends a sign-in link to it. */
export function SignInForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'sent' } | { status: 'failed'; message: string }>({ status: 'idle' });
  if (state.status === 'sent')
    return (
      <p className="m-0 text-sm" role="status">
        A sign-in link is on its way to <span className="font-medium">{email.trim()}</span>. Open it in this browser.
      </p>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setState({ status: 'sending' });
        requestLink(email)
          .then(() => setState({ status: 'sent' }))
          .catch((error: Error) => setState({ status: 'failed', message: error.message }));
      }}
    >
      <label className="block">
        <MicroLabel>Email address</MicroLabel>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={`mt-1.5 w-full rounded border border-line bg-bg px-3 text-sm ${compact ? 'h-8' : 'h-10'}`}
        />
      </label>
      {state.status === 'failed' && (
        <p className="m-0 mt-2 text-sm text-warn" role="alert">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={!email.trim() || state.status === 'sending'}
        className={`mt-3 w-full rounded border border-accent text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-50 ${compact ? 'h-8' : 'h-10'}`}
      >
        {state.status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      <p className="m-0 mt-2 text-[11px] leading-snug text-mute">
        No password. Only addresses that have been given access are let in.
      </p>
    </form>
  );
}

/** The account control in the header: sign in, or who is signed in and what they can reach. */
export function AccountMenu({ me }: { me: Me | null }) {
  // The landing page's "Sign in" arrives with ?signin, which opens this straight away.
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('signin'));
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', close);
    addEventListener('keydown', close);
    return () => {
      removeEventListener('mousedown', close);
      removeEventListener('keydown', close);
    };
  }, [open]);

  const email = me?.email ?? null;
  // Nothing to offer: no sign-in service in this build, and nobody signed in.
  if (!email && !SIGN_IN_AVAILABLE) return null;
  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={email ?? 'Sign in'}
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded border border-line px-2 text-xs hover:bg-raised"
      >
        <Icon name="user" size={13} />
        <span className="hidden max-w-36 truncate sm:inline">{email ?? 'Sign in'}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Account" className="absolute right-0 top-9 z-40 w-72 rounded-lg border border-line bg-panel p-4 shadow-2xl shadow-black">
          {email ? (
            <>
              <MicroLabel>Signed in</MicroLabel>
              <div className="mt-1 truncate font-medium">{email}</div>
              <div className="text-[11px] text-mute">
                {me?.role ? <span className="capitalize">{me.role}</span> : 'Not on the list of users: no access of its own'}
              </div>
              {canReview(me) && (
                <a href={pageUrl('review')} className="mt-3 flex h-8 items-center justify-center rounded border border-line text-xs hover:border-accent hover:text-accent">
                  Open the review queue
                </a>
              )}
              {hasSession() && (
                <button type="button" className="mt-2 h-8 w-full rounded border border-line text-xs hover:bg-raised" onClick={() => void signOut()}>
                  Sign out
                </button>
              )}
            </>
          ) : (
            <>
              {signInProblem && <p className="m-0 mb-3 text-sm text-warn">The sign-in link did not work: {signInProblem}</p>}
              <SignInForm compact />
            </>
          )}
        </div>
      )}
    </div>
  );
}
