import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { ErrorBody, EventDetail } from '../schemas.js';

export const eventRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  app.get(
    '/events/:id',
    {
      schema: {
        summary: 'Detail card for one event',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: EventDetail, 404: ErrorBody },
      },
    },
    async (req, reply) => {
      const [event] = await sql<EventDetail[]>`
        select
          e.id, e.name, e.venue, e.city, e.country, e.starts_at, e.ends_at, e.url,
          st_x(e.geom::geometry) as lon, st_y(e.geom::geometry) as lat,
          -- An organiser that is not published is not named.
          (
            select jsonb_build_object('id', g.id, 'name', g.name)
            from organisation g
            where g.id = e.organiser_id and g.status = 'published'
          ) as organiser
        from event e
        where e.id = ${req.params.id} and e.status = 'published'
      `;
      if (!event) return reply.code(404).send({ error: 'Event not found' });
      return event;
    },
  );
};
