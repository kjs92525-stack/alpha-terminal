export const CYCLE_REVIEW_DATE:string;
export interface CycleBusinessProfile {
  symbol:string;business:string;earnings:string;upside:string;confirm:string[];risk:string;valuation:string;
  reviewedAt:string;sources:Array<{url:string;label:string}>;
}
export interface CycleResearch {
  profile:CycleBusinessProfile|null;observations:string[];cautions:string[];sectorMismatch:boolean;
  officialFacts:Array<{date:string;kind:string;text:string;meaning:string;url:string}>;
  status:string;snapshotAsOf:string;reviewAfterSnapshot:boolean;conclusion:string;
}
export interface CycleResearchStock {
  symbol:string;filed:string;prevYoY:number;revYoY:number;niImproved:boolean;ret63:number|null;
  posIn52w:number|null;dilution:string|null;dilutionChecked:boolean;
}
export function cycleResearchTickers():string[];
export function buildCycleResearch(stock:CycleResearchStock,sector:{sector:string},asOf:string,now?:number):CycleResearch;
