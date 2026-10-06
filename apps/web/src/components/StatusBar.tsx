import type { Stats } from '../api';
import { DEMO_DATA } from '../config';
import { formatAgo, formatCount } from '../lib/format';
import { MicroLabel } from './ui';

function Item({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <MicroLabel>{label}</MicroLabel>
      <span className="tabular-nums text-ink">{value}</span>
    </span>
  );
}

export function StatusBar({
  stats,
  failed,
  inView,
  filtered,
}: {
  stats: Stats | null;
  failed: boolean;
  /** Organisations and events currently passing the filters. */
  inView: number;
  filtered: boolean;
}) {
  const status = failed
    ? { text: 'Offline', dot: 'bg-crit' }
    : DEMO_DATA
      ? { text: 'Demo data', dot: 'bg-warn' }
      : { text: 'Live', dot: 'bg-good' };
  return (
    <footer className="flex h-7 shrink-0 items-center gap-5 overflow-hidden border-t border-line bg-panel px-3 text-[11px]">
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <MicroLabel>Data status</MicroLabel>
        <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
        <span>{status.text}</span>
      </span>
      {stats && (
        <>
          <Item label={filtered ? 'Entities in view' : 'Entities'} value={formatCount(inView)} />
          <Item label="Locations" value={formatCount(stats.offices)} />
          <Item label="Countries" value={formatCount(stats.countries)} />
          {stats.last_updated && <Item label="Last updated" value={formatAgo(stats.last_updated)} />}
        </>
      )}
      <span className="ml-auto hidden items-baseline gap-2 whitespace-nowrap md:flex">
        <span className="font-semibold">
          eco<span className="text-accent2">Sight</span>
        </span>
        <MicroLabel>Ecosystem intelligence platform</MicroLabel>
      </span>
    </footer>
  );
}
