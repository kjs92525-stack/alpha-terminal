export interface StoryEvidence { kind: string; title: string; url: string | null; publishedAt: string; period?: string; value?: number; source: string; confidence: string }
export interface StoryRow { ticker: string; name: string; status: string; evidence: StoryEvidence[]; reasons: Array<{ factor: string; points: number; text: string }>; risk: { level: string; checked: boolean } }
export interface EarlyStory { title: string; business: string; change: string; thesis: string; next: string; risk: string; sources: Array<{ label: string; url: string }>; publishedAt?: string; reviewedAt?: string; reviewed: boolean; stale: boolean; funding: string; status: string }
export function buildEarlyStory(row: StoryRow, asOf: string): EarlyStory;
export function representativeEvidence(row: StoryRow, asOf: string): StoryEvidence[];
