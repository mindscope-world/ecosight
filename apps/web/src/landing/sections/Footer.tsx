import { Eyebrow, MAP_URL, REPO_URL } from '../ui';
import { Wordmark } from './Navbar';

// An entry with no address is a page that does not exist yet. It is shown as
// plain text so the footer's shape is final without any link leading nowhere.
const COLUMNS: { title: string; links: [label: string, href?: string][] }[] = [
  {
    title: 'Product',
    links: [
      ['Explore Map', MAP_URL],
      ['Startups', `${MAP_URL}#v=1&p=startups`],
      ['Investors', `${MAP_URL}#v=1&p=investors`],
      ['Ecosystems', `${MAP_URL}#v=1&p=ecosystems`],
      ['Events', `${MAP_URL}#v=1&p=events`],
      ['Insights', '#signals'],
    ],
  },
  {
    title: 'Use cases',
    links: [
      ['Founders', '#founders'],
      ['Investors', '#investors'],
      ['Accelerators', '#builders'],
      ['NGOs', '#builders'],
      ['Development Funders', '#builders'],
    ],
  },
  {
    title: 'Company',
    links: [
      ['About'],
      ['Data', `${REPO_URL}/blob/main/docs/sources.md`],
      ['Methodology'],
      ['Contact'],
    ],
  },
  { title: 'Legal', links: [['Privacy'], ['Terms'], ['Data Policy']] },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-bg text-ink">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.3fr_repeat(4,1fr)]">
        <div>
          <Wordmark />
          <p className="mt-3 text-sm text-slate">See where innovation happens.</p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <Eyebrow className="text-slate">{column.title}</Eyebrow>
            <ul className="mt-4 space-y-2.5 text-sm">
              {column.links.map(([label, href]) => (
                <li key={label}>
                  {href ? (
                    <a
                      href={href}
                      {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="text-ink/85 transition-colors hover:text-accent"
                    >
                      {label}
                    </a>
                  ) : (
                    <span className="text-slate/60" title="Not available yet">{label}</span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-5 text-xs text-slate sm:px-8">© 2026 ecoSight</p>
      </div>
    </footer>
  );
}
