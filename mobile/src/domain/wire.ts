/**
 * Reading Bandcamp's wire values without trusting any of them; every reader answers undefined rather than guessing (ADR-0004).
 * Ported from server/packages/projection/src/wire.ts (task 0036).
 */
import type { ItemType } from './types';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readText(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function readId(source: Record<string, unknown>, key: string): number | undefined {
  return asId(source[key]);
}

export function asId(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Strings only: release pages carry packed numbers like `20260805` that are not Unix seconds. */
export function readDate(source: Record<string, unknown>, key: string): Date | undefined {
  const value = source[key];
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function asTralbumType(value: string | undefined): ItemType | undefined {
  if (value === 'a' || value === 't') return value;
  if (value === 'album') return 'a';
  if (value === 'track') return 't';
  return undefined;
}
