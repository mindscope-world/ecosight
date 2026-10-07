import type { ReactNode } from 'react';
import { PAGES, pageUrl, type AnyPage } from '../pages';
import { AccountMenu, canReview, useMe } from './Account';
import { NotificationsMenu, SavedMenu } from './HeaderMenus';
import { Logo } from './TopNavigation';

const linkClass = (current: boolean) =>
  `flex items-center border-b-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${
    current ? 'border-accent text-accent' : 'border-transparent text-mute hover:text-ink'
  }`;

/** The header of the pages beside the map: the same bar, with the pages as links. */
export function SiteNav({ current, children }: { current: AnyPage; children?: ReactNode }) {
  const me = useMe();
  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-panel px-3">
      <Logo />
      <nav aria-label="Main" className="flex h-full min-w-0 items-stretch overflow-x-auto">
        {PAGES.map((page) => (
          <a key={page.id} href={pageUrl(page.id)} aria-current={page.id === current ? 'page' : undefined} className={linkClass(page.id === current)}>
            {page.label}
          </a>
        ))}
        {/* Shown to those who can use it; the page itself checks again. */}
        {(canReview(me) || current === 'review') && (
          <a href={pageUrl('review')} aria-current={current === 'review' ? 'page' : undefined} className={linkClass(current === 'review')}>
            Review
          </a>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        {children}
        <NotificationsMenu />
        {current !== 'review' && <SavedMenu page={current} me={me} />}
        <AccountMenu me={me} />
      </div>
    </header>
  );
}
