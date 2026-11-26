import { AREA_MAX_KM, countActive, NO_FILTERS, type Filters, type InvestorFilter } from '@atlas/schema';
import type { ReactNode } from 'react';
import { POINT_LAYERS } from '../entities';
import { countryName } from '../lib/format';
import type { DrawMode } from '../map/adapter';
import { Chip, Icon, MicroLabel, ShapeIcon } from './ui';

const RAISED_STEPS = [
  { label: 'Any', value: null },
  { label: '$100K+', value: 100_000 },
  { label: '$1M+', value: 1_000_000 },
  { label: '$10M+', value: 10_000_000 },
] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 border-0 border-t border-line px-3 py-2.5">
      <legend className="float-left mb-1.5 w-full p-0">
        <MicroLabel>{title}</MicroLabel>
      </legend>
      <div className="clear-both">{children}</div>
    </fieldset>
  );
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

const INVESTOR_OPTIONS: [InvestorFilter, string, string][] = [
  ['any', 'Any', 'Every investor'],
  ['active', 'Active', 'Took part in a round in the last 12 months'],
  ['lead', 'Lead investor', 'Has led at least one round'],
  ['portfolio', 'Has portfolio', 'Has at least one company on record'],
];

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-mute">
      {label}
      <input
        type="date"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-7 rounded border border-line bg-bg px-2 text-ink"
      />
    </label>
  );
}

function YearInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-mute">
      {label}
      <input
        type="number"
        min={1800}
        max={2100}
        inputMode="numeric"
        placeholder="year"
        value={value ?? ''}
        onChange={(event) => {
          const year = event.target.valueAsNumber;
          onChange(Number.isInteger(year) && year >= 1800 && year <= 2100 ? year : null);
        }}
        className="h-7 w-20 rounded border border-line bg-bg px-2 text-ink"
      />
    </label>
  );
}

export function FilterPanel({
  filters,
  onChange,
  options,
  enabled,
  onToggleLayer,
  matching,
  drawMode,
  onDrawMode,
  onClose,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** Values that occur in the data, so no option leads to an empty map by construction. */
  options: { sectors: string[]; stages: string[]; cities: string[]; countries: string[] };
  enabled: ReadonlySet<string>;
  onToggleLayer: (id: string, on: boolean) => void;
  /** Organisations passing the filters. */
  matching: number;
  /** The kind of area being drawn on the map, if one is. */
  drawMode: DrawMode | null;
  /** Start drawing an area of this kind, or stop drawing with null. */
  onDrawMode: (mode: DrawMode | null) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <MicroLabel>Filters</MicroLabel>
        <span className="flex items-center gap-3">
          <button
            type="button"
            className="text-xs text-accent2 hover:underline disabled:text-mute/50 disabled:no-underline"
            disabled={countActive(filters) === 0}
            onClick={() => onChange(NO_FILTERS)}
          >
            Clear all
          </button>
          <button type="button" aria-label="Close filters" className="text-mute hover:text-ink" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Group title="Entity type">
          <div className="flex flex-wrap gap-1">
            {POINT_LAYERS.filter((layer) => !layer.overlay).map((layer) => (
              <Chip key={layer.id} active={enabled.has(layer.id)} onClick={() => onToggleLayer(layer.id, !enabled.has(layer.id))}>
                <span className="flex items-center gap-1.5">
                  <ShapeIcon shape={layer.shape} color={layer.color} size={10} />
                  {layer.noun}
                </span>
              </Chip>
            ))}
          </div>
        </Group>
        <Group title="Sector">
          <div className="flex flex-wrap gap-1">
            {options.sectors.map((sector) => (
              <Chip key={sector} active={filters.sectors.includes(sector)} onClick={() => set({ sectors: toggle(filters.sectors, sector) })}>
                {sector}
              </Chip>
            ))}
          </div>
        </Group>
        <Group title="Funding stage">
          <div className="flex flex-wrap gap-1">
            {options.stages.map((stage) => (
              <Chip key={stage} active={filters.stages.includes(stage)} onClick={() => set({ stages: toggle(filters.stages, stage) })}>
                {stage}
              </Chip>
            ))}
          </div>
        </Group>
        <Group title="Funding raised">
          <div className="flex flex-wrap gap-1">
            {RAISED_STEPS.map((step) => (
              <Chip key={step.label} active={filters.raisedMin === step.value} onClick={() => set({ raisedMin: step.value })}>
                {step.label}
              </Chip>
            ))}
          </div>
        </Group>
        <Group title="Geography">
          {options.countries.length > 1 && (
            <select
              aria-label="Country"
              value={filters.country ?? ''}
              onChange={(event) => set({ country: event.target.value || null })}
              className="mb-1.5 h-7 w-full rounded border border-line bg-bg px-2"
            >
              <option value="">All countries</option>
              {options.countries.map((country) => (
                <option key={country} value={country}>{countryName(country)}</option>
              ))}
            </select>
          )}
          <select
            aria-label="City"
            value={filters.city ?? ''}
            onChange={(event) => set({ city: event.target.value || null })}
            className="h-7 w-full rounded border border-line bg-bg px-2"
          >
            <option value="">All cities</option>
            {options.cities.map((city) => (
              <option key={city}>{city}</option>
            ))}
          </select>
          <div className="mt-2 flex flex-wrap gap-1">
            {(
              [
                ['circle', 'Draw a radius'],
                ['polygon', 'Draw a polygon'],
              ] as const
            ).map(([mode, label]) => (
              <Chip key={mode} active={drawMode === mode} onClick={() => onDrawMode(drawMode === mode ? null : mode)}>
                {label}
              </Chip>
            ))}
          </div>
          {drawMode && (
            <p className="m-0 mt-1.5 text-[11px] leading-snug text-accent2" role="status">
              {drawMode === 'circle'
                ? 'Click the centre on the map, then click the edge. Esc cancels.'
                : 'Click each corner on the map, then double-click or press Enter to finish. Esc cancels.'}
            </p>
          )}
          {filters.area && !drawMode && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-mute">
              {filters.area.type === 'circle' ? (
                <label className="flex items-center gap-1.5">
                  Within
                  <input
                    type="number"
                    aria-label="Radius in kilometres"
                    min={0.1}
                    max={AREA_MAX_KM}
                    step={0.5}
                    value={filters.area.km}
                    onChange={(event) => {
                      const km = event.target.valueAsNumber;
                      if (filters.area?.type === 'circle' && Number.isFinite(km) && km >= 0.1 && km <= AREA_MAX_KM)
                        set({ area: { ...filters.area, km } });
                    }}
                    className="h-7 w-20 rounded border border-line bg-bg px-2 text-ink"
                  />
                  km of the point
                </label>
              ) : (
                <span>Inside the polygon ({filters.area.ring.length} corners)</span>
              )}
              <button type="button" className="text-xs text-accent2 hover:underline" onClick={() => set({ area: null })}>
                Remove area
              </button>
            </div>
          )}
        </Group>
        <Group title="Founded">
          <div className="flex gap-3">
            <YearInput label="From" value={filters.foundedFrom} onChange={(foundedFrom) => set({ foundedFrom })} />
            <YearInput label="To" value={filters.foundedTo} onChange={(foundedTo) => set({ foundedTo })} />
          </div>
        </Group>
        <Group title="Funding round in">
          <div className="flex gap-3">
            <YearInput label="From" value={filters.fundedFrom} onChange={(fundedFrom) => set({ fundedFrom })} />
            <YearInput label="To" value={filters.fundedTo} onChange={(fundedTo) => set({ fundedTo })} />
          </div>
        </Group>
        <Group title="Investor activity">
          <div className="flex flex-wrap gap-1">
            {INVESTOR_OPTIONS.map(([value, label, hint]) => (
              <Chip key={value} active={filters.investor === value} title={hint} onClick={() => set({ investor: value })}>
                {label}
              </Chip>
            ))}
          </div>
          <p className="m-0 mt-1.5 text-[11px] text-mute">Narrows investors only.</p>
        </Group>
        <Group title="Event date">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            <DateInput label="From" value={filters.eventFrom} onChange={(eventFrom) => set({ eventFrom })} />
            <DateInput label="To" value={filters.eventTo} onChange={(eventTo) => set({ eventTo })} />
          </div>
        </Group>
        <Group title="Status">
          <div className="flex gap-1">
            {(['all', 'active', 'inactive'] as const).map((status) => (
              <Chip key={status} active={filters.status === status} onClick={() => set({ status })}>
                {{ all: 'All', active: 'Active', inactive: 'Inactive' }[status]}
              </Chip>
            ))}
          </div>
        </Group>
      </div>
      <div className="shrink-0 border-t border-line px-3 py-2 text-mute" aria-live="polite">
        <span className="font-medium text-ink tabular-nums">{matching}</span> organisation{matching === 1 ? '' : 's'} match
      </div>
    </div>
  );
}
