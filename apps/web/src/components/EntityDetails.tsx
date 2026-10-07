import type { Selection } from '@atlas/schema';
import type { ReactNode } from 'react';
import type { EventDetail, OrgDetail, OrgLink } from '../api';
import { layerForTypes, POINT_LAYERS, TYPE_LABELS } from '../entities';
import { formatDate, formatDateTime, formatMoney, formatPartialDate, formatUsd } from '../lib/format';
import { AFFILIATION_LABELS } from '../graph/style';
import { Icon, MicroLabel, ShapeIcon } from './ui';

export type Detail =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'org'; org: OrgDetail }
  | { status: 'event'; event: EventDetail };

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-3 py-2.5">
      <MicroLabel>{title}</MicroLabel>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

/** Only http(s) links are rendered as links; anything else is shown as text. */
function SourceLink({ url }: { url: string | null }) {
  if (!url || !/^https?:\/\//i.test(url)) return <span>{url ?? 'No link recorded'}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent2 underline">
      {new URL(url).hostname}
    </a>
  );
}

function OrgButton({ org, onSelect }: { org: OrgLink; onSelect: (selection: Selection) => void }) {
  const layer = layerForTypes(org.types);
  return (
    <button
      type="button"
      className="flex h-6 w-full items-center gap-2 text-left hover:text-accent"
      title="Open and show on the map"
      onClick={() => onSelect({ kind: 'org', id: org.id })}
    >
      {layer && <ShapeIcon shape={layer.shape} color={layer.color} size={11} />}
      <span className="truncate">{org.name}</span>
    </button>
  );
}

function Group({ label, children, count }: { label: string; children: ReactNode; count: number }) {
  if (count === 0) return null;
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-0.5 text-[11px] text-mute">
        {label} · {count}
      </div>
      {children}
    </div>
  );
}

/** A round's amount in the currency it was reported in, or that it was not disclosed. */
function amountOf(round: OrgDetail['rounds'][number]): string {
  if (round.amount_original == null || !round.currency) return 'undisclosed';
  return formatMoney(round.amount_original, round.currency);
}

function OrgBody({
  org,
  onSelect,
  actions,
}: {
  org: OrgDetail;
  onSelect: (selection: Selection) => void;
  actions?: (org: OrgDetail) => ReactNode;
}) {
  const layer = layerForTypes(org.types);
  const hq = org.offices[0];
  const latest = org.rounds[0];
  const { investors, portfolio, programs, events, people, affiliations } = org.connections;
  const connected = investors.length + portfolio.length + programs.length + events.length + people.length + affiliations.length;
  // Ties grouped by how they read from this organisation's side: "Part of", "Hosts".
  const ties = new Map<string, typeof affiliations>();
  for (const item of affiliations) {
    const label = AFFILIATION_LABELS[item.kind]?.[item.outgoing ? 0 : 1] ?? item.kind;
    ties.set(label, [...(ties.get(label) ?? []), item]);
  }
  // Investors and programs are described by what they back, not by what they raised.
  const company = org.types.includes('startup');
  return (
    <>
      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 text-[11px] text-mute">
          {layer && <ShapeIcon shape={layer.shape} color={layer.color} />}
          {org.types.map((type) => TYPE_LABELS[type] ?? type).join(' · ')}
        </div>
        <h2 className="mb-0.5 mt-1 text-lg font-semibold leading-tight">{org.name}</h2>
        {org.sectors.length > 0 && <div className="text-accent">{org.sectors.join(' / ')}</div>}
        {hq && (
          <div className="text-mute">
            {hq.city}, {hq.country}
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Fact label="Founded" value={org.founded_year ?? '—'} />
          {company ? (
            <Fact label={org.raised_usd > 0 ? 'Funding' : 'Stage'} value={org.raised_usd > 0 ? formatUsd(org.raised_usd) : (org.stage ?? '—')} />
          ) : (
            <Fact label="Portfolio" value={portfolio.length > 0 ? `${portfolio.length} on record` : '—'} />
          )}
          <Fact
            label="Status"
            value={
              <span className={org.is_active ? 'text-good' : 'text-warn'}>
                {org.is_active ? 'Active' : 'Inactive'}
              </span>
            }
          />
        </div>
        {actions && <div className="mt-3 flex flex-wrap gap-1.5">{actions(org)}</div>}
      </div>

      {org.description && (
        <Block title="Company">
          <p className="m-0 leading-snug">{org.description}</p>
          {org.website_domain && (
            <p className="m-0 mt-1">
              <SourceLink url={`https://${org.website_domain}`} />
            </p>
          )}
        </Block>
      )}

      {org.rounds.length === 0 && (org.funding_note || org.stage) && (
        <Block title={company ? 'Funding' : 'Capital'}>
          {org.stage && <Fact label="Stage" value={org.stage} />}
          {org.funding_note && <p className="m-0 mt-1.5 leading-snug text-mute">{org.funding_note}</p>}
        </Block>
      )}

      {org.rounds.length > 0 && (
        <Block title="Funding">
          <div className="grid grid-cols-3 gap-2">
            <Fact label="Total raised" value={org.raised_usd > 0 ? formatUsd(org.raised_usd) : '—'} />
            <Fact label="Latest round" value={latest?.stage ?? '—'} />
            <Fact label="Latest amount" value={latest ? amountOf(latest) : '—'} />
          </div>
          <ul className="mt-2 text-mute">
            {org.rounds.map((round) => (
              <li key={round.id} className="flex justify-between tabular-nums">
                <span>{round.stage ?? 'Round'}</span>
                <span>
                  {amountOf(round)}
                  {round.announced_on && ` · ${formatPartialDate(round.announced_on, round.announced_precision)}`}
                </span>
              </li>
            ))}
          </ul>
          {org.funding_note && <p className="m-0 mt-2 text-[11px] leading-snug text-mute">{org.funding_note}</p>}
        </Block>
      )}

      {org.offices.length > 0 && (
        <Block title="Locations">
          <ul>
            {org.offices.map((office) => (
              <li key={office.id} className="flex justify-between gap-2">
                {/* Researched addresses usually name the city already. */}
                <span>{office.address?.includes(office.city) ? office.address : [office.address, office.city].filter(Boolean).join(', ')}</span>
                <span className="text-[11px] text-mute">
                  {office.is_hq ? 'HQ' : 'Branch'}
                  {office.precision === 'city' && ' · city level'}
                  {office.precision === 'area' && ' · area level'}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Connections">
        {connected === 0 && <p className="m-0 text-mute">No connections recorded yet.</p>}
        <Group label="Investors" count={investors.length}>
          {investors.map((item) => <OrgButton key={item.id} org={item} onSelect={onSelect} />)}
        </Group>
        <Group label="Portfolio" count={portfolio.length}>
          {portfolio.map((item) => <OrgButton key={item.id} org={item} onSelect={onSelect} />)}
        </Group>
        <Group label="Programs" count={programs.length}>
          {programs.map((item) => (
            <div key={`${item.name}-${item.organisation.id}`}>
              <OrgButton org={item.organisation} onSelect={onSelect} />
              <div className="-mt-1 pl-[19px] text-[11px] text-mute">{item.name}</div>
            </div>
          ))}
        </Group>
        {[...ties].map(([label, items]) => (
          <Group key={label} label={label} count={items.length}>
            {items.map((item) => (
              <div key={`${item.kind}-${item.organisation.id}`}>
                <OrgButton org={item.organisation} onSelect={onSelect} />
                {item.label && <div className="-mt-1 pl-[19px] text-[11px] text-mute">{item.label}</div>}
              </div>
            ))}
          </Group>
        ))}
        <Group label="Events" count={events.length}>
          {events.map((item) => {
            const pin = POINT_LAYERS.find((entry) => entry.id === 'events')!;
            return (
              <button
                key={item.id}
                type="button"
                className="flex h-6 w-full items-center gap-2 text-left hover:text-accent"
                onClick={() => onSelect({ kind: 'event', id: item.id })}
              >
                <ShapeIcon shape={pin.shape} color={pin.color} size={11} />
                <span className="truncate">{item.name}</span>
              </button>
            );
          })}
        </Group>
        <Group label="People" count={people.length}>
          {people.map((person) => (
            <div key={`${person.name}-${person.role}`} className="flex h-6 items-center justify-between gap-2">
              {person.linkedin_url && /^https:\/\/www\.linkedin\.com\/in\//.test(person.linkedin_url) ? (
                <a
                  href={person.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-accent2 underline"
                  title={`${person.name} on LinkedIn (opens in a new tab)`}
                >
                  {person.name}
                </a>
              ) : (
                <span className="shrink-0">{person.name}</span>
              )}
              {/* A long role gives way to the name, and can be read in full on hover. */}
              <span className="min-w-0 truncate text-[11px] text-mute" title={person.role}>
                {person.role}
              </span>
            </div>
          ))}
        </Group>
      </Block>

      <Block title="Sources">
        <ul>
          {org.sources.map((source) => (
            <li key={`${source.field}-${source.source_url}`}>
              <span className="text-mute">
                {source.field} ({source.method}):{' '}
              </span>
              {/* With no link, the stated basis is what there is to show. */}
              {!source.source_url && source.quote ? <span>{source.quote}</span> : <SourceLink url={source.source_url} />}
            </li>
          ))}
          {org.sources.length === 0 && <li className="text-mute">No sources recorded</li>}
        </ul>
        <p className="m-0 mt-1.5 text-[11px] text-mute">
          {org.last_verified_at ? `Last verified ${formatDate(org.last_verified_at)}` : 'Not yet verified'}
        </p>
      </Block>
    </>
  );
}

function EventBody({ event, onSelect }: { event: EventDetail; onSelect: (selection: Selection) => void }) {
  const pin = POINT_LAYERS.find((entry) => entry.id === 'events')!;
  return (
    <>
      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 text-[11px] text-mute">
          <ShapeIcon shape={pin.shape} color={pin.color} />
          Event
        </div>
        <h2 className="mb-0.5 mt-1 text-lg font-semibold leading-tight">{event.name}</h2>
        <div className="text-mute">{[event.venue, event.city, event.country].filter(Boolean).join(', ')}</div>
      </div>
      <Block title="When">
        {formatDateTime(event.starts_at)}
        {event.ends_at && ` to ${formatDateTime(event.ends_at)}`}
      </Block>
      {event.organiser && (
        <Block title="Organiser">
          <button
            type="button"
            className="text-left hover:text-accent"
            onClick={() => onSelect({ kind: 'org', id: event.organiser!.id })}
          >
            {event.organiser.name}
          </button>
        </Block>
      )}
      {event.url && (
        <Block title="Link">
          <SourceLink url={event.url} />
        </Block>
      )}
    </>
  );
}

export function EntityDetails({
  detail,
  onSelect,
  onClose,
  back,
  actions,
}: {
  detail: Detail;
  /** Return to the list this record was picked from, when there is one. */
  back?: { label: string; onBack: () => void };
  /** Open a connected record; the map follows. */
  onSelect: (selection: Selection) => void;
  onClose: () => void;
  /** Links shown under an organisation's headline figures, such as to another page. */
  actions?: (org: OrgDetail) => ReactNode;
}) {
  return (
    <div aria-live="polite">
      <div className="flex h-8 items-center justify-between px-3">
        {back ? (
          <button type="button" className="flex items-center gap-1 text-[11px] text-accent2 hover:underline" onClick={back.onBack}>
            <Icon name="chevronLeft" size={12} />
            {back.label}
          </button>
        ) : (
          <MicroLabel>Selected</MicroLabel>
        )}
        <button type="button" aria-label="Close details" className="text-mute hover:text-ink" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {detail.status === 'loading' && <p className="px-3 text-mute">Loading…</p>}
      {detail.status === 'error' && <p className="px-3 text-mute">This record could not be loaded.</p>}
      {detail.status === 'org' && <OrgBody org={detail.org} onSelect={onSelect} actions={actions} />}
      {detail.status === 'event' && <EventBody event={detail.event} onSelect={onSelect} />}
    </div>
  );
}

/** A link styled as a small button, for the actions under an organisation's figures. */
export function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="flex h-7 items-center rounded border border-line px-2 text-xs hover:border-accent hover:text-accent">
      {children}
    </a>
  );
}
