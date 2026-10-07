import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyContextConfig } from 'fastify';
import type { Sql } from '../db.js';
import { FilterQuery, filtersFrom } from '../filters.js';
import {
  coInvestment,
  EDGE_KINDS,
  expand,
  GraphError,
  mostConnected,
  neighbourhood,
  nodeId,
  parseKinds,
  shortestPath,
} from '../graph.js';
import {
  ErrorBody,
  GraphCoInvestment,
  GraphExpansion,
  GraphNeighbourhood,
  GraphPath,
  GraphTop,
  OrgType,
} from '../schemas.js';

const NodeId = (description: string) => Type.String({ minLength: 1, maxLength: 140, description });

// Shared by every graph route: which kinds of link to follow, and the same
// filters the map takes, so a share link means the same thing on both pages.
const Scope = {
  kinds: Type.Optional(
    Type.String({
      description: `Kinds of link, comma-separated: ${EDGE_KINDS.join(', ')}. Investments, programmes and events when not given`,
    }),
  ),
  ...FilterQuery,
};

const errors = { 400: ErrorBody, 404: ErrorBody, 503: ErrorBody };

export const graphRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  // A graph query is several database queries, so it shares search's smaller allowance.
  const config: FastifyContextConfig = app.searchLimit ? { rateLimit: { max: app.searchLimit, timeWindow: '1 minute' } } : {};
  const scopeOf = (query: Record<string, unknown>) => ({
    kinds: parseKinds(typeof query.kinds === 'string' ? query.kinds : undefined),
    filters: filtersFrom(query),
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof GraphError) return reply.code(error.status).send({ error: error.message });
    return reply.send(error);
  });

  app.get(
    '/graph/neighbourhood',
    {
      schema: {
        summary: 'A node and what is linked to it, to a chosen depth',
        querystring: Type.Object({
          id: NodeId('An organisation id, or a node id such as org:<id>, event:<id>, sector:<name>'),
          depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 3, default: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 300, default: 150, description: 'Most nodes to return' })),
          ...Scope,
        }),
        response: { 200: GraphNeighbourhood, ...errors },
      },
      config,
    },
    async (req) => neighbourhood(sql, nodeId(req.query.id), req.query.depth ?? 1, req.query.limit ?? 150, scopeOf(req.query)),
  );

  app.post(
    '/graph/expand',
    {
      schema: {
        summary: 'Neighbours of one node that are not on screen yet, a page at a time',
        querystring: Type.Object(Scope),
        body: Type.Object({
          id: NodeId('The node to expand'),
          known: Type.Optional(
            Type.Array(NodeId('A node id'), { maxItems: 500, description: 'Nodes already on screen. They are not sent again' }),
          ),
          offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
        }),
        response: { 200: GraphExpansion, ...errors },
      },
      config,
    },
    async (req) =>
      expand(
        sql,
        nodeId(req.body.id),
        (req.body.known ?? []).map(nodeId),
        req.body.offset ?? 0,
        req.body.limit ?? 25,
        scopeOf(req.query),
      ),
  );

  app.get(
    '/graph/path',
    {
      schema: {
        summary: 'The shortest chain of links between two nodes',
        querystring: Type.Object({
          from: NodeId('Where the chain starts'),
          to: NodeId('Where it ends'),
          max: Type.Optional(Type.Integer({ minimum: 1, maximum: 8, default: 6, description: 'Longest chain to look for, in links' })),
          ...Scope,
        }),
        response: { 200: GraphPath, ...errors },
      },
      config,
    },
    async (req) => shortestPath(sql, nodeId(req.query.from), nodeId(req.query.to), req.query.max ?? 6, scopeOf(req.query)),
  );

  app.get(
    '/graph/co-investment',
    {
      schema: {
        summary: 'Investors that back the same companies, and companies that share investors',
        querystring: Type.Object({
          id: Type.String({ format: 'uuid', description: 'An organisation id' }),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
          ...FilterQuery,
        }),
        response: { 200: GraphCoInvestment, ...errors },
      },
      config,
    },
    async (req) => coInvestment(sql, nodeId(req.query.id), req.query.limit ?? 20, { filters: filtersFrom(req.query) }),
  );

  app.get(
    '/graph/top',
    {
      schema: {
        summary: 'The most connected organisations',
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
          type: Type.Optional(OrgType),
          ...Scope,
        }),
        response: { 200: GraphTop, ...errors },
      },
      config,
    },
    async (req) => mostConnected(sql, req.query.limit ?? 10, req.query.type, scopeOf(req.query)),
  );
};
