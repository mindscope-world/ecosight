import { Type, type Static, type TSchema } from '@sinclair/typebox';

export const OrgType = Type.Union([
  Type.Literal('startup'),
  Type.Literal('fund'),
  Type.Literal('angel_network'),
  Type.Literal('ngo'),
  Type.Literal('accelerator'),
  Type.Literal('corporate'),
  Type.Literal('incubator'),
  Type.Literal('development_funder'),
  Type.Literal('innovation_hub'),
  Type.Literal('university'),
  Type.Literal('government_program'),
]);
export type OrgType = Static<typeof OrgType>;

const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()]);

// How much of a round's date is real: a round "in 2021" is stored as 1 January.
const DatePrecision = Type.Union([Type.Literal('day'), Type.Literal('month'), Type.Literal('year'), Type.Null()]);

const OrgLink = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  types: Type.Array(OrgType),
});

export const Office = Type.Object({
  id: Type.String({ format: 'uuid' }),
  is_hq: Type.Boolean(),
  address: Nullable(Type.String()),
  city: Type.String(),
  country: Type.String(),
  precision: Type.Union([Type.Literal('address'), Type.Literal('area'), Type.Literal('city')]),
  lon: Type.Number(),
  lat: Type.Number(),
});

export const FieldSource = Type.Object({
  field: Type.String(),
  source_url: Nullable(Type.String()),
  method: Type.Union([Type.Literal('manual'), Type.Literal('partner'), Type.Literal('ai')]),
  // The words a value rests on: a quotation from the source, or the stated basis when there is no link.
  quote: Type.Optional(Nullable(Type.String())),
  verified_at: Nullable(Type.String({ format: 'date-time' })),
});

export const OrgDetail = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  slug: Type.String(),
  types: Type.Array(OrgType),
  sectors: Type.Array(Type.String()),
  stage: Nullable(Type.String()),
  website_domain: Nullable(Type.String()),
  description: Nullable(Type.String()),
  offices: Type.Array(Office),
  founded_year: Nullable(Type.Integer()),
  is_active: Type.Boolean(),
  raised_usd: Type.Number(),
  // Funding as the research words it, for records with no round rows.
  funding_note: Nullable(Type.String()),
  rounds: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      stage: Nullable(Type.String()),
      amount_usd: Nullable(Type.Number()),
      amount_original: Nullable(Type.Number()),
      currency: Nullable(Type.String()),
      announced_on: Nullable(Type.String({ format: 'date' })),
      announced_precision: DatePrecision,
    }),
  ),
  // The organisation's neighbours in the ecosystem graph.
  connections: Type.Object({
    investors: Type.Array(OrgLink),
    portfolio: Type.Array(OrgLink),
    programs: Type.Array(Type.Object({ name: Type.String(), organisation: OrgLink })),
    events: Type.Array(Type.Object({ id: Type.String({ format: 'uuid' }), name: Type.String() })),
    people: Type.Array(Type.Object({ name: Type.String(), role: Type.String() })),
  }),
  sources: Type.Array(FieldSource),
  last_verified_at: Nullable(Type.String({ format: 'date-time' })),
});
export type OrgDetail = Static<typeof OrgDetail>;

const OrgRef = Type.Object({ id: Type.String({ format: 'uuid' }), name: Type.String() });

export const EventDetail = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  organiser: Nullable(OrgRef),
  venue: Nullable(Type.String()),
  city: Nullable(Type.String()),
  country: Nullable(Type.String()),
  starts_at: Type.String({ format: 'date-time' }),
  ends_at: Nullable(Type.String({ format: 'date-time' })),
  url: Nullable(Type.String()),
  lon: Nullable(Type.Number()),
  lat: Nullable(Type.Number()),
});
export type EventDetail = Static<typeof EventDetail>;

export const RoundDetail = Type.Object({
  id: Type.String({ format: 'uuid' }),
  organisation: OrgRef,
  stage: Nullable(Type.String()),
  amount_original: Nullable(Type.Number()),
  currency: Nullable(Type.String()),
  amount_usd: Nullable(Type.Number()),
  announced_on: Nullable(Type.String({ format: 'date' })),
  announced_precision: DatePrecision,
  investors: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      is_lead: Type.Boolean(),
    }),
  ),
  sources: Type.Array(FieldSource),
});
export type RoundDetail = Static<typeof RoundDetail>;

export const SearchResponse = Type.Object({
  // How the query was read: recognised type, sector and place words.
  understood: Type.Object({
    type: Nullable(OrgType),
    sector: Nullable(Type.String()),
    city: Nullable(Type.String()),
  }),
  organisations: Type.Array(Type.Any()),
  events: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      venue: Nullable(Type.String()),
      starts_at: Type.String({ format: 'date-time' }),
      lon: Type.Number(),
      lat: Type.Number(),
    }),
  ),
  // People are found only through their role at a published organisation.
  people: Type.Array(
    Type.Object({ name: Type.String(), role: Type.String(), organisation: Type.Any() }),
  ),
  locations: Type.Array(
    Type.Object({
      city: Type.String(),
      country: Type.String(),
      organisations: Type.Integer(),
      lon: Type.Number(),
      lat: Type.Number(),
    }),
  ),
  sectors: Type.Array(Type.Object({ sector: Type.String(), organisations: Type.Integer() })),
});

export const SearchResult = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  types: Type.Array(OrgType),
  sector: Nullable(Type.String()),
  city: Nullable(Type.String()),
  lon: Nullable(Type.Number()),
  lat: Nullable(Type.Number()),
});
export type SearchResult = Static<typeof SearchResult>;

const Trend = Type.Object({ current: Type.Integer(), previous: Type.Integer() });

export const Stats = Type.Object({
  organisations: Type.Integer(),
  offices: Type.Integer(),
  countries: Type.Integer(),
  last_updated: Nullable(Type.String({ format: 'date-time' })),
  // Each compares the last 30 days with the 30 before; investors use 12 months.
  activity: Type.Object({
    startups_added: Trend,
    rounds_announced: Trend,
    active_investors: Trend,
    programs_added: Trend,
    events_next_30_days: Type.Integer(),
  }),
  cities: Type.Array(
    Type.Object({
      city: Type.String(),
      country: Type.String(),
      organisations: Type.Integer(),
      rounds_12m: Type.Integer(),
      upcoming_events: Type.Integer(),
      score: Type.Integer(),
      lon: Type.Number(),
      lat: Type.Number(),
    }),
  ),
  funding_by_month: Type.Array(
    Type.Object({ month: Type.String(), amount_usd: Type.Number(), rounds: Type.Integer() }),
  ),
  recent: Type.Array(
    Type.Object({
      kind: Type.Union([Type.Literal('organisation'), Type.Literal('round'), Type.Literal('event')]),
      // The record to open: an organisation id, or an event id for events.
      id: Type.String({ format: 'uuid' }),
      label: Type.String(),
      at: Type.String({ format: 'date-time' }),
    }),
  ),
  upcoming_events: Type.Integer(),
  rounds: Type.Integer(),
  raised_usd: Type.Number(),
  by_type: Type.Array(Type.Object({ type: OrgType, count: Type.Integer() })),
  top_sectors: Type.Array(Type.Object({ sector: Type.String(), count: Type.Integer() })),
  recent_rounds: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      organisation_id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      stage: Nullable(Type.String()),
      amount_usd: Nullable(Type.Number()),
      announced_on: Nullable(Type.String({ format: 'date' })),
    }),
  ),
});
export type Stats = Static<typeof Stats>;

export const ErrorBody = Type.Object({ error: Type.String() });
