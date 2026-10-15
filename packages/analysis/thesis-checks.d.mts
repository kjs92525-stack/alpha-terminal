export interface ThesisItem { label: string; met: boolean | null; observed: string }
export interface ThesisChecks { state: 'drop' | 'review' | 'watch'; promote: ThesisItem[]; drop: ThesisItem[]; unknown: number; nextDue: string | null }
export function thesisChecks(row: unknown, asOf: string): ThesisChecks;
