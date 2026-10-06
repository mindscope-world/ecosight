import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { SearchResponse, type OrgType, type SearchResult } from '../schemas.js';

// Words people use for each kind of organisation, singular and plural.
const TYPE_WORDS: Record<string, OrgType> = {
  startup: 'startup',
  investor: 'fund',
  vc: 'fund',
  fund: 'fund',
  angel: 'angel_network',
  accelerator: 'accelerator',
  incubator: 'incubator',
  ngo: 'ngo',
  hub: 'innovation_hub',
  university: 'university',
  universities: 'university',
  corporate: 'corporate',
};

export interface ParsedQuery {
  type: OrgType | null;
  sector: string | null;
  city: string | null;
  /** What is left after the recognised words are taken out. */
  text: string;
}

/**
 * Reads the recognisable parts of a query such as "fintech investors in Nairobi":
 * a kind of organisation, a known sector and a known city. Anything else is kept
 * as free text. Nothing is guessed: a word only counts if it is in the lists.
 */
export function parseQuery(query: string, sectors: readonly string[], cities: readonly string[]): ParsedQuery {
  const parsed: ParsedQuery = { type: null, sector: null, city: null, text: '' };
  let rest = ` ${query.toLowerCase().replace(/\s+/g, ' ').trim()} `;

  // Longest names first, so "Cape Town" is not read as a shorter city.
  for (const city of [...cities].sort((a, b) => b.length - a.length)) {
    const at = rest.indexOf(` ${city.toLowerCase()} `);
    if (at < 0) continue;
    parsed.city = city;
    rest = `${rest.slice(0, at)} ${rest.slice(at + city.length + 2)}`;
    break;
  }
  const words = rest.trim().split(' ').filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const singular = word.replace(/s$/, '');
    const type = TYPE_WORDS[word] ?? TYPE_WORDS[singular];
    const sector = sectors.find((s) => s.toLowerCase() === word);
    if (type && !parsed.type) parsed.type = type;
    else if (sector && !parsed.sector) parsed.sector = sector;
    else if (!['in', 'near', 'at', 'the'].includes(word)) kept.push(word);
  }
  parsed.text = kept.join(' ');
  return parsed;
}

const like = (text: string) => '%' + text.replace(/[\\%_]/g, '\\$&') + '%';

export const searchRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  app.get(
    '/search',
    {
      schema: {
        summary: 'Find organisations, events, cities and sectors',
        querystring: Type.Object({
          q: Type.String({ minLength: 2, maxLength: 80 }),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 8 })),
        }),
        response: { 200: SearchResponse },
      },
      config: app.searchLimit ? { rateLimit: { max: app.searchLimit, timeWindow: '1 minute' } } : {},
    },
    async (req) => {
      const q = req.query.q.trim();
      const limit = req.query.limit ?? 8;

      const [known] = await sql<{ sectors: string[]; cities: string[] }[]>`
        select
          coalesce((select array_agg(distinct s) from organisation, unnest(sectors) s
            where status = 'published'), '{}') as sectors,
          coalesce((select array_agg(distinct city) from public_office), '{}') as cities
      `;
      const parsed = parseQuery(q, known!.sectors, known!.cities);
      const structured = Boolean(parsed.type || parsed.sector || parsed.city);
      // With recognised words, the rest of the query narrows by name; with none,
      // the whole query is matched as text.
      const text = structured ? parsed.text : q;

      // Full-text finds whole words anywhere in the record; trigram similarity on
      // the name catches typos and partial words that full-text misses.
      const organisations = await sql<SearchResult[]>`
        with scored as (
          select g.id, g.name, g.types::text[] as types, g.sectors[1] as sector,
            ts_rank(g.search, websearch_to_tsquery('simple', ${text})) as text_rank,
            greatest(similarity(g.name, ${text}), word_similarity(${text}, g.name)) as name_rank
          from organisation g
          where g.status = 'published'
            and (${parsed.type}::org_type is null or ${parsed.type}::org_type = any(g.types))
            and (${parsed.sector}::text is null or ${parsed.sector}::text = any(g.sectors))
            and (${parsed.city}::text is null or exists (
              select 1 from office o
              where o.organisation_id = g.id and o.valid_to is null and o.city = ${parsed.city}
            ))
            and (
              ${text} = ''
              or g.search @@ websearch_to_tsquery('simple', ${text})
              or g.name % ${text}
              or ${text} <% g.name
              or g.name ilike ${like(text)}
            )
        )
        select s.id, s.name, s.types, s.sector, o.city,
          st_x(o.geom::geometry) as lon, st_y(o.geom::geometry) as lat
        from scored s
        -- Headquarters if there is one, otherwise the oldest current office.
        left join lateral (
          select city, geom from office
          where organisation_id = s.id and valid_to is null
          order by is_hq desc, valid_from nulls last
          limit 1
        ) o on true
        order by s.name_rank * 2 + s.text_rank desc, s.name
        limit ${limit}
      `;

      const events = await sql`
        select event_id as id, name, venue, starts_at,
          st_x(geom::geometry) as lon, st_y(geom::geometry) as lat
        from public_event
        where coalesce(ends_at, starts_at) >= now()
          and (name ilike ${like(q)} or name % ${q} or venue ilike ${like(q)})
        order by starts_at limit 5
      `;
      const locations = await sql`
        select city, country, count(distinct organisation_id)::int as organisations,
          avg(st_x(geom::geometry))::float8 as lon, avg(st_y(geom::geometry))::float8 as lat
        from public_office
        where city ilike ${like(q)} or city = ${parsed.city}
        group by city, country order by organisations desc limit 5
      `;
      const sectors = await sql`
        select s as sector, count(*)::int as organisations
        from organisation, unnest(sectors) s
        where status = 'published' and (s ilike ${like(q)} or s = ${parsed.sector})
        group by s order by organisations desc limit 5
      `;

      return {
        understood: { type: parsed.type, sector: parsed.sector, city: parsed.city },
        organisations,
        events: events as never,
        locations: locations as never,
        sectors: sectors as never,
      };
    },
  );
};
