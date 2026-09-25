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
const MONTHS: Readonly<Record<string, number>> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** "18 Aug 2026 07:28:27 GMT", with or without a weekday, a time or the zone. */
const WIRE_DATE = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(?:GMT|UTC|Z)?$/;

/**
 * Bandcamp's date strings, parsed by hand first: Hermes, the phone's engine,
 * rejects the wire format that V8 happens to accept, and every Story carries one.
 */
export function parseWireDate(value: string): Date | undefined {
  const match = WIRE_DATE.exec(value.trim());
  if (match !== null) {
    const month = MONTHS[(match[2] ?? '').toLowerCase()];
    if (month !== undefined) {
      const date = new Date(
        Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0)),
      );
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function readDate(source: Record<string, unknown>, key: string): Date | undefined {
  const value = source[key];
  if (typeof value !== 'string') return undefined;
  return parseWireDate(value);
}

export function asTralbumType(value: string | undefined): ItemType | undefined {
  if (value === 'a' || value === 't') return value;
  if (value === 'album') return 'a';
  if (value === 'track') return 't';
  return undefined;
}
