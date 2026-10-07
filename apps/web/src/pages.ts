/** The app's pages beside the landing page, in the order the navigation lists them. */
export const PAGES = [
  { id: 'map', label: 'Map' },
  { id: 'graph', label: 'Graph' },
  // Not "data": that folder name is kept out of git and out of builds, for the private data files.
  { id: 'dashboard', label: 'Dashboard' },
] as const;
export type PageId = (typeof PAGES)[number]['id'];

/** A page's address, wherever the site is served from, with share-link state when given. */
export const pageUrl = (page: PageId, hash = '') => `${import.meta.env.BASE_URL}${page}/${hash ? `#${hash}` : ''}`;

/** The map opened on one organisation. */
export const mapUrlFor = (orgId: string) => pageUrl('map', `v=1&s=${orgId}`);
/** The graph opened on one organisation. */
export const graphUrlFor = (orgId: string) => pageUrl('graph', `v=1&n=org:${orgId}`);
