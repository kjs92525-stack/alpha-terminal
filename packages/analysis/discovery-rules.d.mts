export type DiscoveryMode = 'early' | 'watch' | 'pivot' | 'legacy';
export function earlyIssues(row: unknown, asOf: string, mode?: DiscoveryMode): string[];
