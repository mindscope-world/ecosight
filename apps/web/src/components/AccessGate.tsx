import { useState } from 'react';
import { storeAccessKey } from '../api';
import { MicroLabel } from './ui';

/**
 * Shown in place of the app when the API asks for an access key. The data is not
 * public, so a deployed copy only opens for people who have been given the key.
 */
export function AccessGate({ rejected }: { rejected: boolean }) {
  const [key, setKey] = useState('');
  return (
    <div className="grid h-full place-items-center px-5">
      <form
        className="w-full max-w-sm rounded-lg border border-line bg-panel p-6"
        onSubmit={(event) => {
          event.preventDefault();
          storeAccessKey(key.trim());
          location.reload();
        }}
      >
        <div className="text-lg font-semibold">
          eco<span className="text-accent2">Sight</span>
        </div>
        <p className="mt-2 text-sm text-mute">This copy is private. Enter the access key you were given.</p>
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
        {rejected && (
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
    </div>
  );
}
