export interface SectorStory {id:string;name:string;etfs:string[];publishedAt:string;reviewedAt:string;headline:string;world:string;chain:string;leading:string;failure:string;sources:Array<{label:string;date:string;url:string}>;symbols:string[]}
export interface BusinessLink {name:string;sector:string;date:string;link:string;fact:string;risk:string;next:string;url:string}
export interface RadarQuote {price?:number|null;marketCap?:number|null;ret21?:number|null;ret63?:number|null;lastDate?:string|null;source?:string}
export interface RadarProxy {etf:string;phase:string;phaseKo:string;metrics:{rs3m:number|null;ret3m:number|null;vs200:number|null}}
export interface SectorRadar {asOf:string;method:string;ideas:Array<SectorStory&{phase:string;stance:string;proxies:RadarProxy[];related:Array<BusinessLink&RadarQuote&{ticker:string;warnings:string[];role:string}>}>}
export function companyMacro(ticker:string,asOf:string):{sector:SectorStory;link:BusinessLink}|null;
export function sectorStory(id:string,asOf:string):SectorStory|null;
export function businessLink(ticker:string,asOf:string):BusinessLink|null;
export function buildSectorRadar(input:{asOf:string;groups?:RadarProxy[];stocks?:Record<string,RadarQuote>}):SectorRadar;
