import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';

export interface Point {
  x: number;
  y: number;
}

interface Body extends SimulationNodeDatum {
  id: string;
}

/**
 * Positions for a graph's nodes, worked out in one go rather than animated, so
 * the same graph always looks the same. Nodes that already have a place keep it
 * when `keep` is set: bringing in a node's neighbours must not rearrange what
 * the reader has already found their way around.
 */
export function layout(
  ids: readonly string[],
  links: readonly { source: string; target: string }[],
  previous: ReadonlyMap<string, Point>,
  keep: boolean,
): Map<string, Point> {
  const neighbour = new Map<string, string>();
  for (const link of links) {
    if (previous.has(link.source) && !previous.has(link.target)) neighbour.set(link.target, link.source);
    if (previous.has(link.target) && !previous.has(link.source)) neighbour.set(link.source, link.target);
  }
  const bodies: Body[] = ids.map((id, index) => {
    const at = previous.get(id);
    if (at && keep) return { id, x: at.x, y: at.y, fx: at.x, fy: at.y };
    // A new node starts beside the neighbour that brought it in, fanned out by its position in the list.
    const near = keep ? previous.get(neighbour.get(id) ?? '') : undefined;
    if (near) return { id, x: near.x + 40 * Math.cos(index * 2.4), y: near.y + 40 * Math.sin(index * 2.4) };
    return { id };
  });
  const known = new Set(ids);
  const simulation = forceSimulation(bodies)
    .force(
      'link',
      forceLink<Body, { source: string; target: string }>(
        links.filter((link) => known.has(link.source) && known.has(link.target)).map((link) => ({ ...link })),
      )
        .id((body) => body.id)
        .distance(90)
        .strength(0.6),
    )
    .force('charge', forceManyBody().strength(-260).distanceMax(420))
    .force('collide', forceCollide(34))
    // A weak pull to the middle keeps separate clusters on the same screen.
    .force('x', forceX(0).strength(0.05))
    .force('y', forceY(0).strength(0.05))
    .stop();
  simulation.tick(Math.min(300, 120 + ids.length));
  return new Map(bodies.map((body) => [body.id, { x: body.x ?? 0, y: body.y ?? 0 }]));
}

/** The box that holds every point, with room for labels. */
export function bounds(points: Iterable<Point>): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (minX === Infinity) return { x: -100, y: -100, width: 200, height: 200 };
  const pad = 70;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
