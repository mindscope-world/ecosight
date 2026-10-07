/**
 * Keeps an open or cached page from outliving its deployment. The host lets a
 * browser keep a page for ten minutes, and a tab can stay open for days, so a
 * reader can be looking at the build before last without knowing.
 *
 * Every build writes its id to `version.json` beside the pages. A page asks for
 * that file, past any cache, when it opens and when its tab is returned to. If
 * the id is not its own, it reloads, once: a reload that still brings the old
 * page is not tried again for that build, so nothing can loop.
 */
declare const __BUILD_ID__: string;

const TRIED = 'ecosight-reloaded-for';
const EVERY_MS = 5 * 60_000;

/** Whether a page built as `mine` should reload, given the build now live and the one last reloaded for. */
export function shouldReload(mine: string, live: unknown, tried: string | null): boolean {
  return typeof live === 'string' && live !== '' && mine !== '' && live !== mine && live !== tried;
}

async function check(mine: string): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const live = ((await response.json()) as { build?: unknown }).build;
    if (!shouldReload(mine, live, sessionStorage.getItem(TRIED))) return;
    sessionStorage.setItem(TRIED, live as string);
    // The address carries the page's state, so the reader comes back to the same view.
    location.reload();
  } catch {
    // Offline, or the file is not there (a development server): the page stays as it is.
  }
}

/** Start watching for a newer build. Does nothing outside a production build. */
export function keepFresh(): void {
  const mine = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
  if (!mine) return;
  let last = Date.now();
  void check(mine);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < EVERY_MS) return;
    last = Date.now();
    void check(mine);
  });
}
