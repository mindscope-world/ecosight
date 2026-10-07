import { VIEWS, type View } from '@atlas/schema';
import { useState } from 'react';
import { VIEW_LABELS } from '../entities';
import { PAGES, pageUrl } from '../pages';
import { AccountMenu, canReview, useMe } from './Account';
import { Icon } from './ui';

/**
 * The pin mark from the logo beside the wordmark. The wordmark is set in text:
 * the logo file's dark "eco" lettering is made for light backgrounds.
 */
export function Logo() {
  const [hasImage, setHasImage] = useState(true);
  return (
    <a href={import.meta.env.BASE_URL} title="ecoSight home" className="flex items-center gap-2">
      {hasImage && (
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-7 w-auto" onError={() => setHasImage(false)} />
      )}
      <span className="text-[15px] font-semibold tracking-tight">
        eco<span className="text-accent2">Sight</span>
      </span>
    </a>
  );
}

export function TopNavigation({
  view,
  onView,
  onSearch,
  onFilters,
  activeFilters,
}: {
  view: View;
  onView: (view: View) => void;
  onSearch: () => void;
  onFilters: () => void;
  activeFilters: number;
}) {
  const me = useMe();
  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-panel px-3">
      <Logo />
      <nav aria-label="Main" className="flex h-full min-w-0 items-stretch overflow-x-auto">
        {VIEWS.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={item === view ? 'page' : undefined}
            onClick={() => onView(item)}
            className={`border-b-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${
              item === view
                ? 'border-accent text-accent'
                : 'border-transparent text-mute hover:text-ink'
            }`}
          >
            {VIEW_LABELS[item]}
          </button>
        ))}
        {/* The other pages. The lenses above stay on this one. */}
        {PAGES.filter((page) => page.id !== 'map').map((page) => (
          <a
            key={page.id}
            href={pageUrl(page.id)}
            className="flex items-center border-b-2 border-transparent px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute hover:text-ink"
          >
            {page.label}
          </a>
        ))}
        {canReview(me) && (
          <a
            href={pageUrl('review')}
            className="flex items-center border-b-2 border-transparent px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute hover:text-ink"
          >
            Review
          </a>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSearch}
          className="hidden h-7 w-72 items-center gap-2 rounded border border-line bg-bg px-2 text-left text-xs text-mute hover:border-mute lg:flex"
        >
          <Icon name="search" size={14} />
          <span className="flex-1 truncate">Startups, investors, cities, sectors...</span>
          <kbd className="rounded border border-line px-1 text-[10px]">Ctrl K</kbd>
        </button>
        <button
          type="button"
          onClick={onFilters}
          className="flex h-7 items-center gap-1.5 rounded border border-line px-2 text-xs hover:bg-raised"
        >
          <Icon name="filter" size={13} />
          <span className="hidden sm:inline">Filters</span>
          {activeFilters > 0 && (
            <span className="rounded-sm bg-accent px-1 text-[10px] font-semibold text-bg">{activeFilters}</span>
          )}
        </button>
        {/* Account features arrive with sign-in; shown so the header's shape is final. */}
        {(['bell', 'bookmark'] as const).map((name) => (
          <button
            key={name}
            type="button"
            disabled
            title={`${{ bell: 'Notifications', bookmark: 'Saved locations' }[name]}: not built yet`}
            aria-label={{ bell: 'Notifications', bookmark: 'Saved locations' }[name]}
            className="hidden h-7 w-7 place-items-center rounded text-mute/50 sm:grid"
          >
            <Icon name={name} size={15} />
          </button>
        ))}
        <AccountMenu me={me} />
      </div>
    </header>
  );
}
