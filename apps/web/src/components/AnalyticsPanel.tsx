import { useState } from 'react';
import type { CityStat, Stats } from '../api';
import { formatAgo, formatMonth, formatUsd } from '../lib/format';
import type { Signal } from '../lib/signals';
import { CityList } from './LeftPanel';
import { Section, Tone } from './ui';

const WIDTH = 280;
const HEIGHT = 96;
const PAD = { top: 8, right: 6, bottom: 16, left: 6 };

/** Funding announced per month: one line, with a crosshair and readout on hover. */
function CapitalChart({ months }: { months: Stats['funding_by_month'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...months.map((month) => month.amount_usd));
  if (max === 0)
    return <p className="text-mute">No funding rounds announced in the last 12 months.</p>;

  const step = (WIDTH - PAD.left - PAD.right) / (months.length - 1);
  const x = (index: number) => PAD.left + index * step;
  const y = (amount: number) =>
    PAD.top + (1 - amount / max) * (HEIGHT - PAD.top - PAD.bottom);
  const line = months.map((month, index) => `${index ? 'L' : 'M'}${x(index)} ${y(month.amount_usd)}`).join(' ');
  const shown = hover === null ? null : months[hover]!;
  const total = months.reduce((sum, month) => sum + month.amount_usd, 0);

  return (
    <figure className="m-0">
      <figcaption className="mb-1 flex items-baseline justify-between">
        <span className="text-lg font-semibold tabular-nums">
          {formatUsd(shown ? shown.amount_usd : total)}
        </span>
        <span className="text-[11px] text-mute">
          {shown
            ? `${formatMonth(shown.month, true)} · ${shown.rounds} round${shown.rounds === 1 ? '' : 's'}`
            : 'last 12 months'}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Funding announced per month, ${formatUsd(total)} over the last 12 months`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const at = ((event.clientX - box.left) / box.width) * WIDTH;
          setHover(Math.max(0, Math.min(months.length - 1, Math.round((at - PAD.left) / step))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--color-line)" />
        <path d={`${line} L${x(months.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="var(--color-accent)" opacity="0.08" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} stroke="var(--color-mute)" strokeDasharray="2 2" />
            <circle cx={x(hover)} cy={y(months[hover]!.amount_usd)} r="4" fill="var(--color-accent)" stroke="var(--color-panel)" strokeWidth="2" />
          </>
        )}
        {[0, Math.floor((months.length - 1) / 2), months.length - 1].map((index) => (
          <text
            key={index}
            x={x(index)}
            y={HEIGHT - 3}
            fontSize="9"
            fill="var(--color-mute)"
            textAnchor={index === 0 ? 'start' : index === months.length - 1 ? 'end' : 'middle'}
          >
            {formatMonth(months[index]!.month)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

const KIND_TEXT = {
  organisation: 'Organisation added',
  round: 'Funding round added',
  event: 'Event added',
} as const;

export function AnalyticsPanel({
  stats,
  signals,
  emerging,
  onCity,
  onRecent,
}: {
  stats: Stats;
  signals: Signal[];
  emerging: CityStat[];
  onCity: (city: CityStat) => void;
  onRecent: (item: Stats['recent'][number]) => void;
}) {
  return (
    <>
      <Section id="signal" title="Ecosystem signal">
        {signals.length === 0 && <p className="text-mute">Not enough activity recorded yet to report a signal.</p>}
        <ul className="space-y-2">
          {signals.map((signal) => (
            <li key={signal.title}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{signal.title}</span>
                {signal.tag && (
                  <span className="text-[11px]">
                    <Tone tone={signal.tag.tone}>{signal.tag.text}</Tone>
                  </span>
                )}
              </div>
              <p className="m-0 text-mute">{signal.detail}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="capital" title="Capital activity">
        <CapitalChart months={stats.funding_by_month} />
      </Section>
      <CityList
        id="emerging"
        title="Emerging cities"
        cities={emerging}
        value={(city) => `${city.rounds_12m + city.upcoming_events} recent`}
        hint="Ranked by recent activity per organisation: rounds announced in the last 12 months plus upcoming events. The figure is that activity count."
        onPick={onCity}
      />
      <Section id="recent" title="Recent activity">
        <ul>
          {stats.recent.map((item, index) => (
            // A company with two rounds loaded together appears twice with the same id and time.
            <li key={`${item.kind}-${item.id}-${index}`}>
              <button
                type="button"
                className="grid w-full grid-cols-[4.5rem_1fr] gap-2 py-1 text-left hover:text-accent"
                onClick={() => onRecent(item)}
              >
                <span className="text-[11px] text-mute tabular-nums">{formatAgo(item.at)}</span>
                <span className="min-w-0">
                  <span className="block text-[11px] text-mute">{KIND_TEXT[item.kind]}</span>
                  <span className="block truncate">{item.label}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
