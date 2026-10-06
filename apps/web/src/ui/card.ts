import { fetchOrg, type OrgDetail } from '../api';

const TYPE_LABELS: Record<string, string> = {
  startup: 'Startup',
  fund: 'Investor',
  angel_network: 'Angel network',
  ngo: 'NGO',
  accelerator: 'Accelerator',
  corporate: 'Corporate',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** Only http(s) links are rendered as links; anything else is shown as text. */
function sourceNode(url: string | null): HTMLElement {
  if (!url || !/^https?:\/\//i.test(url)) return el('span', url ?? 'No link recorded');
  const link = el('a', new URL(url).hostname);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function renderOrg(org: OrgDetail): HTMLElement[] {
  const meta = [
    org.types.map((t) => TYPE_LABELS[t] ?? t).join(', '),
    org.stage,
    org.sectors.join(', '),
  ].filter(Boolean);
  const nodes: HTMLElement[] = [el('h2', org.name), el('p', meta.join(' · '), 'meta')];
  if (org.description) nodes.push(el('p', org.description));

  nodes.push(el('h3', 'Offices'));
  const offices = el('ul');
  for (const office of org.offices) {
    const place = [office.address, office.city].filter(Boolean).join(', ');
    offices.append(el('li', `${office.is_hq ? 'HQ' : 'Branch'}: ${place}`));
  }
  nodes.push(offices);

  nodes.push(el('h3', 'Sources'));
  const sources = el('ul');
  for (const source of org.sources) {
    const item = el('li', `${source.field} (${source.method}): `);
    item.append(sourceNode(source.source_url));
    sources.append(item);
  }
  if (!org.sources.length) sources.append(el('li', 'No sources recorded'));
  nodes.push(sources);

  nodes.push(
    el(
      'p',
      org.last_verified_at
        ? `Last verified ${formatDate(org.last_verified_at)}`
        : 'Not yet verified',
      'verified',
    ),
  );
  return nodes;
}

/** Detail card: fetched on demand so map data stays small and cards stay current. */
export function mountCard(root: HTMLElement, onClose: () => void) {
  let request: AbortController | null = null;

  function show(...content: HTMLElement[]) {
    const close = el('button', '×', 'close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => {
      hide();
      onClose();
    });
    root.replaceChildren(close, ...content);
    root.hidden = false;
  }

  function hide() {
    request?.abort();
    request = null;
    root.hidden = true;
    root.replaceChildren();
  }

  async function open(orgId: string): Promise<OrgDetail | null> {
    request?.abort();
    const current = new AbortController();
    request = current;
    show(el('p', 'Loading…', 'meta'));
    try {
      const org = await fetchOrg(orgId, current.signal);
      if (request !== current) return null;
      show(...renderOrg(org));
      return org;
    } catch {
      if (request === current) show(el('p', 'This organisation could not be loaded.', 'meta'));
      return null;
    }
  }

  return { open, hide };
}
