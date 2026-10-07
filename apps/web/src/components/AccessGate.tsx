import { useState } from 'react';
import { accessDenied, storeAccessKey } from '../api';
import { hasSession, SIGN_IN_AVAILABLE, signInProblem, signOut } from '../auth';
import { SignInForm } from './Account';
import { MicroLabel } from './ui';

/**
 * Shown in place of the app when the API will not answer. The data is not
 * public, so a deployed copy opens only for people who have been given the
 * access key, or who sign in with an address that has been given access.
 */
export function AccessGate({ rejected }: { rejected: boolean }) {
  const [key, setKey] = useState('');
  return (
    <div className="grid h-full place-items-center overflow-y-auto px-5 py-8">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-6">
        <div className="text-lg font-semibold">
          eco<span className="text-accent2">Sight</span>
        </div>
        <p className="mt-2 text-sm text-mute">This copy is private. Enter the access key you were given.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            storeAccessKey(key.trim());
            location.reload();
          }}
        >
          <label className="mt-5 block">
            <MicroLabel>Access key</MicroLabel>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              className="mt-1.5 h-10 w-full rounded border border-line bg-bg px-3 text-sm"
            />
          </label>
          {rejected && !accessDenied && (
            <p className="mt-2 text-sm text-warn" role="alert">
              That key was not accepted.
            </p>
          )}
          <button
            type="submit"
            disabled={!key.trim()}
            className="mt-4 h-10 w-full rounded bg-accent text-sm font-semibold text-bg disabled:opacity-50"
          >
            Open
          </button>
        </form>
        {SIGN_IN_AVAILABLE && (
          <div className="mt-6 border-t border-line pt-5">
            {accessDenied && hasSession() ? (
              <>
                <p className="m-0 text-sm text-warn" role="alert">
                  You are signed in, but that address has not been given access.
                </p>
                <button type="button" className="mt-3 h-10 w-full rounded border border-line text-sm hover:bg-raised" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p className="m-0 mb-3 text-sm text-mute">Or sign in, if your email address has been given access.</p>
                {signInProblem && (
                  <p className="m-0 mb-3 text-sm text-warn" role="alert">
                    The sign-in link did not work: {signInProblem}
                  </p>
                )}
                <SignInForm />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
