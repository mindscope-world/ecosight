import { Type, type Static } from '@sinclair/typebox';

export const OrgType = Type.Union([
  Type.Literal('startup'),
  Type.Literal('fund'),
  Type.Literal('angel_network'),
  Type.Literal('ngo'),
  Type.Literal('accelerator'),
  Type.Literal('corporate'),
]);
export type OrgType = Static<typeof OrgType>;

const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);

export const Office = Type.Object({
  id: Type.String({ format: 'uuid' }),
  is_hq: Type.Boolean(),
  address: Nullable(Type.String()),
  city: Type.String(),
  country: Type.String(),
  precision: Type.Union([Type.Literal('address'), Type.Literal('city')]),
  lon: Type.Number(),
  lat: Type.Number(),
});

export const FieldSource = Type.Object({
  field: Type.String(),
  source_url: Nullable(Type.String()),
  method: Type.Union([Type.Literal('manual'), Type.Literal('partner'), Type.Literal('ai')]),
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
  sources: Type.Array(FieldSource),
  last_verified_at: Nullable(Type.String({ format: 'date-time' })),
});
export type OrgDetail = Static<typeof OrgDetail>;

export const ErrorBody = Type.Object({ error: Type.String() });
