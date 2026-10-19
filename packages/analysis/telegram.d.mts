export interface TgPost { id: number; channel: string; url: string; date: string | null; text: string }
export function parseChannelHtml(html: string, channel: string): TgPost[];
export function extractTickers(text: string, known: Set<string>): string[];
export function mergePosts(prev: TgPost[], fresh: TgPost[], now?: number, days?: number, max?: number): TgPost[];
export function splitMessage(text: string, max?: number): string[];
