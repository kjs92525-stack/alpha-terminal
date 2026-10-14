import type { StoryRow, EarlyStory } from './early-story.mjs';
import type { DemandStory } from './demand-stories.mjs';
export interface DossierRow extends StoryRow {marketCap?:number|null;reportPeriod?:string|null;revenueYoY?:Array<{end:string}>;demo?:boolean}
export interface CompanyDossier {headline:string;preview:string;opening:string;mechanism:string;evidence:string;disagreement:string;price:string;verdict:string;ready:false;priceBridge:string;missing:string;business:DemandStory|null;story:EarlyStory;report:{period:string;publishedAt:string;source:string;quality:string;confirm:string;invalidate:string}}
export function companyDossier(row:DossierRow,asOf:string):CompanyDossier|null;
