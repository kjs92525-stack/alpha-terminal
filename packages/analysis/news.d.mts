export interface HeadlineClass {
  tags: string[]; sentiment: 'positive' | 'negative' | 'neutral'; sentimentScore: number; importance: number;
  matched: { positive: string[]; negative: string[] };
}
export function classifyHeadline(headline: string, summary?: string): HeadlineClass;
