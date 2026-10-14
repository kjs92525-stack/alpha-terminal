export const BUSINESS_REVIEW_DATE:string;
export interface BusinessStory {ticker:string;model:string;business:string;demand:string;risk:string;indicators:string[];url:string;reviewedAt:string;sourceLabel:string;headline:string;preview:string;economics:string;interpretation:string;limitation:string}
export function businessTickers():string[];
export function businessStory(ticker:string,asOf:string):BusinessStory|null;
