import { fetchOffices, type OrgType } from '../api';
import type { MapAdapter } from '../map/adapter';
import type { Layer } from './types';

interface OrganisationLayerOptions {
  id: string;
  label: string;
  color: string;
  type: OrgType;
  onSelect: (orgId: string) => void;
}

/** Offices of one kind of organisation, headquarters and branches alike. */
export function createOrganisationLayer(options: OrganisationLayerOptions): Layer {
  const { id, label, color, type, onSelect } = options;
  let map: MapAdapter | null = null;
  let enabled = false;
  let loaded = false;
  let request: AbortController | null = null;

  return {
    id,
    label,
    color,

    render(target) {
      map = target;
      target.addPointLayer({
        id,
        color,
        onSelect: (properties) => {
          if (typeof properties.org_id === 'string') onSelect(properties.org_id);
        },
      });
      target.setVisible(id, false);
    },

    async setEnabled(next) {
      if (!map) throw new Error(`Layer ${id} is not rendered yet`);
      enabled = next;
      map.setVisible(id, next);
      if (!next) {
        request?.abort();
        request = null;
        return;
      }
      if (loaded || request) return;
      const current = new AbortController();
      request = current;
      try {
        const data = await fetchOffices(type, current.signal);
        map.setData(id, data);
        loaded = true;
      } catch (error) {
        if (!current.signal.aborted) throw error;
      } finally {
        if (request === current) request = null;
      }
    },

    isEnabled: () => enabled,
  };
}
