export interface MarketTheme {id:string;name:string;short:string;etf:string;proxy:string;mechanism:string;confirm:string;risk:string;groups:string[][]}
export interface ThemeMembership {id:string;name:string;group:string}
export interface MarketStock {symbol:string;name:string;sector:string;exchange:string|null;price:number;priceAsOf:string;mcap:number|null;mcapSource?:string;mcapNote?:string;aliases?:string[];ret1:number|null;ret5:number|null;ret21:number|null;ret63:number|null;adv20:number|null;revenueGrowth:number|null;themes:ThemeMembership[]}
export interface MarketSnapshot {model:string;asOf:string;generatedAt:string;universe:number;source:string;coverage:{priced:number;withCap:number;staleExcluded:number;shareClassesExcluded?:number};classification:{reviewedAt:string;method:string};stocks:MarketStock[]}
export const MARKET_THEMES:MarketTheme[];
export const THEME_REVIEWED_AT:string;
export function themeMembership(symbol:string):ThemeMembership[];
export function buildMarketSnapshot(input:{rows:Array<{symbol:string;cik?:string|null;name?:string|null;sector?:string;exchange?:string;features:Record<string,unknown>}>;asOf:string;generatedAt:string;universe:number;source:string}):MarketSnapshot;
export function marketCapEstimate(input:{company:unknown;profile:unknown;bars:Array<{time:number;close:number}>;asOf:string}):{mcap:number|null;source:string;note:string};
export function groupPerformance(stocks:Array<Partial<MarketStock>>,period?:string,size?:string):{value:number|null;measured:number;total:number;advancing:number;declining:number};
