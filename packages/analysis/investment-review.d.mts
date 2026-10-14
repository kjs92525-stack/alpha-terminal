import type { Fundamentals } from './types';
export interface InvestmentInput { ticker:string; asOf:string; price:number|null; marketCap:number|null; status?:string; risk?:{checked?:boolean}; fundamentals?:Fundamentals|null; excluded?:string[]; demo?:boolean }
export interface InvestmentReview { verdict:string; ready:boolean; summary:string; checks:Array<{label:string;state:string;text:string}>; report:{period:string;publishedAt:string;source:string}|null; cash:number|null; restricted:number|null; cashCoverage:number|null; cashNote:string; sensitivities:Array<{name:string;multiple:number;dilution:number;requiredProfit:number}>; price:number|null; stalePrice:boolean; doubt:string; confirm:string; invalidate:string }
export function investmentReview(input:InvestmentInput):InvestmentReview;
