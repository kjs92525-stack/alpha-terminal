export interface FlowStory {headline:string;story:string;evidence:string;profits:string;check:string;failure:string;related:string;sources:Array<{label:string;date:string;url:string}>}
export interface FlowRow {etf:string;name:string;netMillions:number;story:FlowStory|null}
export interface FlowReport {periodStart:string;periodEnd:string;publishedAt:string;reviewedAt:string;expiresAt:string;source:string;url:string;quality:string;status:'reviewed'|'expired'|'unavailable';rows:FlowRow[]}
export function sectorFlowReport(now?:string):FlowReport;
