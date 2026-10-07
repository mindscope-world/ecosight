import { POINT_LAYERS, TYPE_LABELS } from '../entities';
import { countryName, formatDateTime, formatUsd } from '../lib/format';
import type { HoverCard, PickedRecord } from './adapter';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The few words shown beside a marker while the pointer rests on it: what the
 * record is, where it is, and the one figure that says most about it.
 */
export function hoverCard({ layer, properties: record }: PickedRecord): HoverCard | null {
  const name = text(record.name);
  if (!name) return null;
  const place = [text(record.city), record.country ? countryName(text(record.country)) : ''].filter(Boolean).join(', ');
  if (layer === 'events') {
    const when = text(record.starts_at);
    return { title: name, lines: ['Event', [text(record.venue), place].filter(Boolean).join(', '), when ? formatDateTime(when) : ''].filter(Boolean) };
  }
  const types = Array.isArray(record.types) ? (record.types as string[]) : [];
  const kind = types.map((type) => TYPE_LABELS[type] ?? type).join(' · ') || (POINT_LAYERS.find((entry) => entry.id === layer)?.noun ?? '');
  const sectors = Array.isArray(record.sectors) ? (record.sectors as string[]).slice(0, 2).join(' / ') : '';
  const raised = Number(record.raised_usd) || 0;
  const portfolio = Number(record.portfolio) || 0;
  const figure =
    raised > 0
      ? `Raised ${formatUsd(raised)}${record.stage ? ` · ${text(record.stage)}` : ''}`
      : portfolio > 0
        ? `${portfolio} in its portfolio on record`
        : record.stage
          ? `Stage: ${text(record.stage)}`
          : '';
  const where = place && record.precision === 'city' ? `${place} · city level` : place;
  return { title: name, lines: [[kind, sectors].filter(Boolean).join(' · '), where, figure].filter(Boolean) };
}
