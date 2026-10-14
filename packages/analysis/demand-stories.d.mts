export interface DemandStory {title:string;summary:string;demand:string;product:string;edge:string;earnings:string;reviewedAt:string;sources:Array<{label:string;date:string;url:string}>}
export function demandStory(ticker:string,asOf:string):DemandStory|null;
