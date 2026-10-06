import type { Stats } from '../api';
import { formatUsd, trend } from './format';

export interface Signal {
  title: string;
  detail: string;
  /** Short tag beside the title, when the numbers support one. */
  tag?: { text: string; tone: 'up' | 'down' | 'flat' };
}

/**
 * Statements about the ecosystem, each one a fixed rule over counted figures.
 * A rule that has nothing to say produces nothing: no signal is ever filled in.
 */
export function buildSignals(stats: Stats, sectors: { sector: string; share: number }[]): Signal[] {
  const signals: Signal[] = [];
  const { activity } = stats;

  const lead = sectors[0];
  if (lead && lead.share >= 0.2)
    signals.push({
      title: `${lead.sector} leads`,
      detail: `${Math.round(lead.share * 100)}% of organisations in view work in ${lead.sector}.`,
    });

  const tagFor = (current: number, previous: number): Signal['tag'] => {
    const change = trend(current, previous);
    return change.tone === 'none' ? undefined : { text: change.text, tone: change.tone };
  };

  if (activity.rounds_announced.current > 0)
    signals.push({
      title: 'Funding activity',
      detail: `${activity.rounds_announced.current} funding round${activity.rounds_announced.current === 1 ? '' : 's'} announced in the last 30 days.`,
      tag: tagFor(activity.rounds_announced.current, activity.rounds_announced.previous),
    });

  if (activity.active_investors.current > 0)
    signals.push({
      title: 'Investor activity',
      detail: `${activity.active_investors.current} investor${activity.active_investors.current === 1 ? '' : 's'} backed a round in the last 12 months.`,
      tag: tagFor(activity.active_investors.current, activity.active_investors.previous),
    });

  if (activity.startups_added.current > 0)
    signals.push({
      title: 'New on the map',
      detail: `${activity.startups_added.current} startup${activity.startups_added.current === 1 ? '' : 's'} added in the last 30 days.`,
      tag: tagFor(activity.startups_added.current, activity.startups_added.previous),
    });

  const year = stats.funding_by_month.reduce((sum, month) => sum + month.amount_usd, 0);
  if (year > 0)
    signals.push({
      title: 'Capital deployed',
      detail: `${formatUsd(year)} in announced rounds over the last 12 months.`,
    });

  return signals;
}
