/**
 * Error Reports built from a thrown value (task 0038, ADR-0021): the scrubbed message, the name, and the Hermes stack
 * parsed with RN 0.86's own line patterns (`Libraries/Core/Devtools/parseHermesStack.js`) into frames with file
 * basenames only. The ingest Worker imports this file by relative path to scrub again and to build the fingerprint's
 * source, so it imports only the catalogue.
 */
import { WIRE, type ErrorCode, type ErrorSource, type Screen } from './catalogue';

/** `[function, file basename, line, column or bytecode offset]`; a native frame is `[fn, 'native', 0, 0]`. */
export type Frame = readonly [fn: string, file: string, line: number, col: number];

export type ErrorReport = {
  readonly t: number;
  readonly source: ErrorSource;
  readonly fatal: boolean;
  readonly code: ErrorCode | null;
  readonly name: string;
  readonly message: string;
  readonly screen: Screen;
  readonly frames: readonly Frame[];
};

const URLS = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S+/gi;
const QUOTED = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;
const LONG_DIGITS = /\d{5,}/g;

/** URLs, quoted strings and digit runs longer than four go, then the text is cut to 200 characters. Idempotent. */
export function scrubMessage(text: string): string {
  return text
    .replace(URLS, '<url>')
    .replace(QUOTED, '<str>')
    .replace(LONG_DIGITS, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WIRE.maxMessage);
}

const FRAME = /^ {4}at (.+?)(?: \((native)\)?| \((address at )?(.*?):(\d+):(\d+)\))$/;
const PART_MAX = 60;

function basename(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  return path.slice(path.lastIndexOf('/') + 1).slice(0, PART_MAX) || '?';
}

/** Frame lines only; the message lines, component stacks and "skipping N frames" lines are left out. */
export function parseHermesStack(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of stack.split('\n')) {
    const m = FRAME.exec(line);
    if (m === null) continue;
    const fn = (m[1] ?? '').slice(0, PART_MAX);
    frames.push(m[2] === 'native' ? [fn, 'native', 0, 0] : [fn, basename(m[4] ?? ''), Number(m[5]), Number(m[6])]);
    if (frames.length === WIRE.maxFrames) break;
  }
  return frames;
}

function errorName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[^A-Za-z0-9_$.]/g, '').slice(0, 60) : '';
  return name || 'Error';
}

export type ReportAt = {
  readonly t: number;
  readonly source: ErrorSource;
  readonly fatal: boolean;
  readonly screen: Screen;
  readonly code?: ErrorCode;
};

/** Anything can be thrown; a value that is not an Error keeps only its scrubbed text, under the name `NonError`. */
export function buildErrorReport(thrown: unknown, at: ReportAt): ErrorReport {
  const error = thrown instanceof Error ? thrown : null;
  return {
    t: at.t,
    source: at.source,
    fatal: at.fatal,
    code: at.code ?? null,
    name: error ? errorName(error.name) : 'NonError',
    message: scrubMessage(error ? error.message : String(thrown)),
    screen: at.screen,
    frames: error && typeof error.stack === 'string' ? parseHermesStack(error.stack) : [],
  };
}

/** What the Worker hashes into the group fingerprint: build-independent parts only, never frame offsets. */
export function fingerprintSource(report: Pick<ErrorReport, 'source' | 'name' | 'message' | 'code' | 'screen'>): string {
  return [report.source, report.name, scrubMessage(report.message), report.code ?? '', report.screen].join('|');
}
