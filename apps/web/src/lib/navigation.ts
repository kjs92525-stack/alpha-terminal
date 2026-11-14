export const PAGE_IDS = ['dashboard','industries','market-map','watchlist','workbench','market-brief','early-alpha','discover','charts','events','research','performance','alerts','settings'] as const;
export type Page = typeof PAGE_IDS[number];
export function readRoute(hash: string) {
  const [raw, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const symbol = params.get('symbol')?.toUpperCase() ?? '';
  const theme = params.get('theme') ?? '';
  return { page: (PAGE_IDS as readonly string[]).includes(raw) ? raw as Page : 'dashboard' as Page,
    symbol: /^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol) ? symbol : '', theme: /^[a-z]{1,20}$/.test(theme) ? theme : '' };
}
export function routeHash(page: Page, symbol = '', theme = '') {
  const params = new URLSearchParams();
  if (page === 'research' && symbol) params.set('symbol', symbol);
  if (page === 'market-map' && theme) params.set('theme', theme);
  return `#${page}${params.size ? `?${params}` : ''}`;
}
