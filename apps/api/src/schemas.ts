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
    // Other ties to organisations: part of, hosted by, member of, founded by, backed by, partner of.
    // `outgoing` is true when this organisation is the one that is part of, hosted by, and so on.
    affiliations: Type.Array(
      Type.Object({ kind: Type.String(), outgoing: Type.Boolean(), label: Nullable(Type.String()), organisation: OrgLink }),
    ),
    // A profile link is given only where one has been found published, with the person's name in it.
    people: Type.Array(Type.Object({ name: Type.String(), role: Type.String(), linkedin_url: Nullable(Type.String()) })),
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

const GraphNodeKind = Type.Union([
  Type.Literal('organisation'),
  Type.Literal('event'),
  Type.Literal('person'),
  Type.Literal('place'),
  Type.Literal('sector'),
]);

const GraphNodeFacts = {
  // Kind and key together: org:<id>, event:<id>, person:<id>, place:<country>/<city>, sector:<name>.
  id: Type.String(),
  kind: GraphNodeKind,
  // The record's own id, for organisations and events, which have a details card.
  ref: Nullable(Type.String({ format: 'uuid' })),
  name: Type.String(),
  types: Type.Array(OrgType),
  sectors: Type.Array(Type.String()),
  city: Nullable(Type.String()),
  country: Nullable(Type.String()),
  // One line more: a person's role, an event's date.
  detail: Nullable(Type.String()),
};

export const GraphNode = Type.Object({
  ...GraphNodeFacts,
  // Distinct neighbours under the kinds of link and filters asked for.
  degree: Type.Integer(),
  // How many of those neighbours this answer does not show.
  hidden: Type.Integer(),
});
export type GraphNode = Static<typeof GraphNode>;

export const GraphEdge = Type.Object({
  id: Type.String(),
  kind: Type.Union([
    Type.Literal('invested_in'),
    Type.Literal('accelerated_at'),
    Type.Literal('organised'),
    Type.Literal('part_of'),
    Type.Literal('hosted_by'),
    Type.Literal('member_of'),
    Type.Literal('founded_by'),
    Type.Literal('funded_by'),
    Type.Literal('partner_of'),
    Type.Literal('has_role'),
    Type.Literal('located_in'),
    Type.Literal('in_sector'),
  ]),
  source: Type.String(),
  target: Type.String(),
  // A programme's name, or a person's role.
  label: Nullable(Type.String()),
  // The rounds an investment link stands for, newest first. Empty for other kinds.
  rounds: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      stage: Nullable(Type.String()),
      amount_usd: Nullable(Type.Number()),
      announced_on: Nullable(Type.String({ format: 'date' })),
      announced_precision: DatePrecision,
      is_lead: Type.Boolean(),
      source_url: Nullable(Type.String()),
    }),
  ),
  // What a tie between organisations, or a place on a programme, was read from. Empty for other kinds.
  evidence: Type.Array(Type.Object({ source_url: Nullable(Type.String()), quote: Nullable(Type.String()) })),
});
export type GraphEdge = Static<typeof GraphEdge>;

export const GraphNeighbourhood = Type.Object({
  start: Type.String(),
  nodes: Type.Array(GraphNode),
  edges: Type.Array(GraphEdge),
  // True when there were more nodes within reach than the limit allows.
  truncated: Type.Boolean(),
});

export const GraphExpansion = Type.Object({
  id: Type.String(),
  // The expanded node first, then the neighbours on this page.
  nodes: Type.Array(GraphNode),
  edges: Type.Array(GraphEdge),
  // Neighbours the caller did not already have, and how many are still to come.
  total: Type.Integer(),
  remaining: Type.Integer(),
});

export const GraphPath = Type.Object({
  found: Type.Boolean(),
  length: Nullable(Type.Integer()),
  nodes: Type.Array(GraphNode),
  edges: Type.Array(GraphEdge),
  // False when the search stopped at its length or size limit, so a longer chain may exist.
  searched_all: Type.Boolean(),
});

const GraphTie = Type.Object({
  organisation: Type.Object(GraphNodeFacts),
  // The companies, or the investors, the two have in common.
  shared: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
});

export const GraphCoInvestment = Type.Object({
  organisation: Type.Object(GraphNodeFacts),
  co_investors: Type.Array(GraphTie),
  shared_investors: Type.Array(GraphTie),
});

export const GraphTop = Type.Object({ organisations: Type.Array(GraphNode) });

export const GraphOverview = Type.Object({
  nodes: Type.Array(GraphNode),
  edges: Type.Array(GraphEdge),
  // True when the network has more connected nodes than the limit; the best connected are kept.
  truncated: Type.Boolean(),
  total_nodes: Type.Integer(),
});

// One row of the data tables: what is on record about an organisation, without its sources.
export const OrgRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  types: Type.Array(OrgType),
  sectors: Type.Array(Type.String()),
  stage: Nullable(Type.String()),
  city: Nullable(Type.String()),
  country: Nullable(Type.String()),
  precision: Nullable(Type.Union([Type.Literal('address'), Type.Literal('area'), Type.Literal('city')])),
  founded_year: Nullable(Type.Integer()),
  is_active: Type.Boolean(),
  website_domain: Nullable(Type.String()),
  raised_usd: Type.Number(),
  // Published rounds it raised, and distinct investors named in them.
  rounds: Type.Integer(),
  investors: Type.Integer(),
  // Companies it has backed, and the latest round it took part in.
  portfolio: Type.Integer(),
  last_invested_on: Nullable(Type.String({ format: 'date' })),
  // When it was put on record, when its latest round was announced, and when a programme of its was last added.
  added_on: Type.String({ format: 'date' }),
  last_round_on: Nullable(Type.String({ format: 'date' })),
  last_program_on: Nullable(Type.String({ format: 'date' })),
  // Organisations that went through a programme it runs.
  participants: Type.Integer(),
  people: Type.Integer(),
  last_verified_at: Nullable(Type.String({ format: 'date-time' })),
});
export type OrgRow = Static<typeof OrgRow>;

export const OrgList = Type.Object({ total: Type.Integer(), organisations: Type.Array(OrgRow) });

export const Me = Type.Object({
  // The address that signed in. Null when the request carried the shared access key, or nothing.
  email: Nullable(Type.String()),
  // Null when nobody signed in, and when the address that did is not on the list of users.
  role: Nullable(Type.Union([Type.Literal('viewer'), Type.Literal('reviewer'), Type.Literal('admin')])),
});

export const ReviewItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  kind: Type.Union([Type.Literal('organisation'), Type.Literal('relationship'), Type.Literal('other')]),
  status: Type.Union([Type.Literal('pending'), Type.Literal('approved'), Type.Literal('rejected'), Type.Literal('archived')]),
  // Why it was not published by the importer's own rules.
  reason: Nullable(Type.String()),
  // What the reviewer wrote when rejecting or archiving it.
  note: Nullable(Type.String()),
  // The import it came from.
  source: Nullable(Type.String()),
  created_at: Type.String({ format: 'date-time' }),
  reviewed_at: Nullable(Type.String({ format: 'date-time' })),
  reviewed_by: Nullable(Type.String()),
  organisation: Nullable(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      types: Type.Array(OrgType),
      sectors: Type.Array(Type.String()),
      stage: Nullable(Type.String()),
      description: Nullable(Type.String()),
      website_domain: Nullable(Type.String()),
      status: Type.String(),
      city: Nullable(Type.String()),
      country: Nullable(Type.String()),
      sources: Type.Integer(),
    }),
  ),
  proposal: Nullable(
    Type.Object({
      kind: Nullable(Type.String()),
      from: Nullable(Type.String()),
      to: Nullable(Type.String()),
      label: Nullable(Type.String()),
      source_url: Nullable(Type.String()),
      quote: Nullable(Type.String()),
      // The published record each name finds, when it finds one.
      from_match: Nullable(OrgLink),
      to_match: Nullable(OrgLink),
    }),
  ),
});
export type ReviewItem = Static<typeof ReviewItem>;

export const ReviewList = Type.Object({
  pending: Type.Integer(),
  // Set aside as incomplete or unverified.
  archived: Type.Integer(),
  // Approved or rejected by a reviewer.
  settled: Type.Integer(),
  items: Type.Array(ReviewItem),
});

export const SavedView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  page: Type.Union([Type.Literal('map'), Type.Literal('graph'), Type.Literal('dashboard')]),
  // The view's share-link state, without the leading #.
  state: Type.String(),
  created_at: Type.String({ format: 'date-time' }),
});
export type SavedView = Static<typeof SavedView>;

export const Notifications = Type.Object({
  // Everything published since the time asked about; `items` holds the newest twenty.
  total: Type.Integer(),
  items: Type.Array(
    Type.Object({
      kind: Type.Union([Type.Literal('organisation'), Type.Literal('round')]),
      organisation_id: Type.String({ format: 'uuid' }),
      label: Type.String(),
      // For a round, its stage.
      detail: Nullable(Type.String()),
      at: Type.String({ format: 'date-time' }),
    }),
  ),
  // Items waiting in the review queue. Null for anyone who is not a reviewer.
  waiting_review: Nullable(Type.Integer()),
});
export type Notifications = Static<typeof Notifications>;
