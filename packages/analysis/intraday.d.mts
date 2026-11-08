import type { Bar } from './types';
export function etParts(iso: string): { day: string; h: number; m: number };
export function toFourHour(hourly: Bar[]): Array<{ day: string; t: string; o: number; h: number; l: number; c: number; v: number }>;
export function regularSession(bars: Bar[]): Bar[];
export function fourHourBars(hourly: Bar[]): Bar[];
