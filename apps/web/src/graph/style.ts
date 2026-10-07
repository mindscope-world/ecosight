import type { EdgeKind, GraphNode } from '../api';
import { layerForTypes, POINT_LAYERS, type Shape } from '../entities';

export const KIND_LABELS: Record<EdgeKind, string> = {
  invested_in: 'Invested in',
  accelerated_at: 'Went through a programme at',
  organised: 'Organised',
  has_role: 'Founded or leads',
  located_in: 'Located in',
  in_sector: 'Works in a sector',
};

/** Line colour and dash pattern per kind of link. Dashes differ too, so colour is not the only signal. */
export const KIND_LINES: Record<EdgeKind, { color: string; dash?: string; width: number }> = {
  invested_in: { color: '#22d3ee', width: 1.6 },
  accelerated_at: { color: '#199e70', dash: '6 3', width: 1.6 },
  organised: { color: '#d55181', dash: '2 3', width: 1.6 },
  has_role: { color: '#8b9aa7', width: 1 },
  located_in: { color: '#5b6f7d', dash: '1 4', width: 1 },
  in_sector: { color: '#5b6f7d', dash: '4 4', width: 1 },
};

export const DEFAULT_KINDS: EdgeKind[] = ['invested_in', 'accelerated_at', 'organised'];

const EVENT = POINT_LAYERS.find((layer) => layer.id === 'events')!;

/** How a node is drawn: organisations and events as on the map, the rest as plain outlines. */
export function nodeMark(node: Pick<GraphNode, 'kind' | 'types'>): { shape: Shape; color: string; outline: boolean; label: string } {
  if (node.kind === 'organisation') {
    const layer = layerForTypes(node.types);
    return { shape: layer?.shape ?? 'circle', color: layer?.color ?? '#8b9aa7', outline: false, label: layer?.noun ?? 'Organisation' };
  }
  if (node.kind === 'event') return { shape: EVENT.shape, color: EVENT.color, outline: false, label: 'Event' };
  if (node.kind === 'person') return { shape: 'circle', color: '#8b9aa7', outline: false, label: 'Person' };
  if (node.kind === 'place') return { shape: 'circle', color: '#e6edf3', outline: true, label: 'Place' };
  return { shape: 'square', color: '#e6edf3', outline: true, label: 'Sector' };
}
