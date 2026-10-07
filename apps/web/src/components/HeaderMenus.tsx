import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ApiError,
  fetchNotifications,
  fetchSaved,
  removeSaved,
  saveView,
  type Me,
  type Notifications,
  type SavedView,
} from '../api';
import { formatAgo, formatDate } from '../lib/format';
import { mapUrlFor, pageUrl, PAGES } from '../pages';
import { Icon, MicroLabel } from './ui';

/** A panel under a header button that closes on Escape or a click elsewhere. */
function usePopover(): [boolean, (open: boolean) => void, RefObject<HTMLDivElement | null>] {
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !frame.current?.contains(event.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', close);
    addEventListener('keydown', close);
    return () => {
      removeEventListener('mousedown', close);
      removeEventListener('keydown', close);
    };
  }, [open]);
  return [open, setOpen, frame];
}

function HeaderButton({
  icon,
  label,
  open,
  onClick,
  badge,
}: {
  icon: 'bell' | 'bookmark';
  label: string;
  open: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      aria-label={badge ? `${label}: ${badge} new` : label}
      aria-expanded={open}
      aria-haspopup="dialog"
      title={label}
      onClick={onClick}
      className="relative hidden h-7 w-7 place-items-center rounded text-mute hover:bg-raised hover:text-ink sm:grid"
    >
      <Icon name={icon} size={15} />
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-accent px-0.5 text-[9px] font-semibold tabular-nums text-bg">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}

const panel = 'absolute right-0 top-9 z-40 w-80 rounded-lg border border-line bg-panel shadow-2xl shadow-black';

// Views saved without an account are kept in the browser, and stay there.
const LOCAL_STORE = 'ecosight-saved-views';
function readLocal(): SavedView[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_STORE) ?? '[]') as SavedView[];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}
function writeLocal(views: SavedView[]): void {
  try {
    localStorage.setItem(LOCAL_STORE, JSON.stringify(views));
  } catch {}
}

/**
 * Saved views: the page as it stands now, under a name, to come back to. With
 * an account they are kept with it; without one, in this browser.
 */
export function SavedMenu({ page, me }: { page: SavedView['page']; me: Me | null }) {
  const [open, setOpen, frame] = usePopover();
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // An address with a role has an account to keep them in.
  const withAccount = Boolean(me?.role);

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    if (!withAccount) setViews(readLocal());
    else
      fetchSaved()
        .then(setViews)
        .catch(() => setProblem('Your saved views could not be loaded.'));
  }, [open, withAccount]);

  const save = () => {
    const view = { name: name.trim(), page, state: location.hash.replace(/^#/, '') };
    if (!view.name) return;
    setProblem(null);
    if (!withAccount) {
      const next = [{ ...view, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...readLocal()].slice(0, 50);
      writeLocal(next);
      setViews(next);
      setName('');
      return;
    }
    saveView(view)
      .then((saved) => {
        setViews((now) => [saved, ...(now ?? [])]);
        setName('');
      })
      .catch((error) => setProblem(error instanceof ApiError && error.detail ? error.detail : 'The view could not be saved.'));
  };

  const remove = (id: string) => {
    setViews((now) => (now ?? []).filter((view) => view.id !== id));
    if (withAccount) void removeSaved(id);
    else writeLocal(readLocal().filter((view) => view.id !== id));
  };

  const go = (view: SavedView) => {
    location.assign(pageUrl(view.page, view.state));
    // The same page with a different address does not load again by itself; the pages read their state once.
    if (view.page === page) location.reload();
  };

  return (
    <div ref={frame} className="relative">
      <HeaderButton icon="bookmark" label="Saved views" open={open} onClick={() => setOpen(!open)} />
      {open && (
        <div role="dialog" aria-label="Saved views" className={panel}>
          <form
            className="border-b border-line p-3"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="block">
              <MicroLabel>Save this view</MicroLabel>
              <input
                value={name}
                maxLength={80}
                placeholder="A name to find it by"
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 h-8 w-full rounded border border-line bg-bg px-2 text-xs placeholder:text-mute"
              />
            </label>
            <button type="submit" disabled={!name.trim()} className="mt-2 h-8 w-full rounded bg-accent text-xs font-semibold text-bg disabled:opacity-40">
              Save
            </button>
            {problem && (
              <p className="m-0 mt-2 text-xs text-warn" role="alert">
                {problem}
              </p>
            )}
          </form>
          <ul className="max-h-72 overflow-y-auto py-1">
            {views?.length === 0 && <li className="px-3 py-2 text-mute">Nothing saved yet.</li>}
            {views?.map((view) => (
              <li key={view.id} className="flex items-center gap-1 px-1">
                <button type="button" className="min-w-0 flex-1 rounded px-2 py-1.5 text-left hover:bg-raised" onClick={() => go(view)}>
                  <span className="block truncate">{view.name}</span>
                  <span className="block text-[11px] text-mute">
                    {PAGES.find((item) => item.id === view.page)?.label} · {formatDate(view.created_at)}
                  </span>
                </button>
                <button type="button" aria-label={`Remove ${view.name}`} className="grid h-7 w-7 shrink-0 place-items-center rounded text-mute hover:bg-raised hover:text-ink" onClick={() => remove(view.id)}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
          <p className="m-0 border-t border-line px-3 py-2 text-[11px] leading-snug text-mute">
            {withAccount ? 'Kept with your account.' : 'Kept in this browser only. Sign in to keep them with your account.'}
          </p>
        </div>
      )}
    </div>
  );
}

const SEEN_STORE = 'ecosight-notifications-seen';

/** What has been published since the reader last looked, and for reviewers what is waiting. */
export function NotificationsMenu(): ReactNode {
  const [open, setOpen, frame] = usePopover();
  const [news, setNews] = useState<Notifications | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    let since: string | null = null;
    try {
      since = localStorage.getItem(SEEN_STORE);
    } catch {}
    let alive = true;
    fetchNotifications(since)
      .then((answer) => alive && setNews(answer))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const waiting = news?.waiting_review ?? 0;
  const fresh = seen ? 0 : (news?.total ?? 0);
  const toggle = () => {
    setOpen(!open);
    if (open || !news) return;
    // Opening the list is looking: the next visit starts counting from now.
    setSeen(true);
    try {
      localStorage.setItem(SEEN_STORE, new Date().toISOString());
    } catch {}
  };

  return (
    <div ref={frame} className="relative">
      <HeaderButton icon="bell" label="What is new" open={open} onClick={toggle} badge={fresh + (waiting > 0 ? 1 : 0)} />
      {open && (
        <div role="dialog" aria-label="What is new" className={panel}>
          {waiting > 0 && (
            <a href={pageUrl('review')} className="block border-b border-line px-3 py-2.5 hover:bg-raised">
              <span className="font-medium text-accent">
                {waiting} item{waiting === 1 ? '' : 's'} waiting for review
              </span>
              <span className="block text-[11px] text-mute">Open the review queue</span>
            </a>
          )}
          <div className="px-3 pb-1 pt-2.5">
            <MicroLabel>Published since you last looked{news && news.total > 0 ? ` · ${news.total}` : ''}</MicroLabel>
          </div>
          {!news && <p className="m-0 px-3 pb-3 text-mute">Loading…</p>}
          {news?.items.length === 0 && <p className="m-0 px-3 pb-3 text-mute">Nothing new.</p>}
          <ul className="max-h-80 overflow-y-auto pb-1">
            {news?.items.map((item) => (
              <li key={`${item.kind}-${item.organisation_id}-${item.at}`}>
                <a href={mapUrlFor(item.organisation_id)} className="block px-3 py-1.5 hover:bg-raised">
                  <span className="block truncate">{item.label}</span>
                  <span className="block text-[11px] text-mute">
                    {item.kind === 'round' ? `${item.detail ?? 'Funding round'} recorded` : 'Organisation added'} · {formatAgo(item.at)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {news && news.total > news.items.length && (
            <p className="m-0 border-t border-line px-3 py-2 text-[11px] text-mute">And {news.total - news.items.length} more. The newest are shown.</p>
          )}
        </div>
      )}
    </div>
  );
}
