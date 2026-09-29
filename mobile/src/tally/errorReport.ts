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

/** In order; no placeholder matches a later pattern, so a second pass changes nothing. */
const SCRUBS: readonly (readonly [RegExp, string])[] = [
  [/\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S+/gi, '<url>'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>'],
  // A Bandcamp subdomain names a Fan or a Page without a scheme, and a host followed by a path is a URL.
  [/\b(?:[a-z0-9-]+\.)+(?:bandcamp|bcbits)\.com\S*|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*/gi, '<url>'],
  [/'[^']*'|"[^"]*"|`[^`]*`/g, '<str>'],
  // An absolute path carries a home folder or an app container's id.
  [/~?(?:\/[^\s/]+){2,}\/?/g, '<path>'],
  [/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '<id>'],
  [/\b(?=[\w-]*\d)(?=[\w-]*[a-z])[\w-]{16,}/gi, '<id>'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>'],
  [/\d{5,}/g, '<n>'],
];

/**
 * URLs, emails, quoted strings, file paths, ids, IP addresses and digit runs longer than four go, then the text is cut
 * to 200 characters. Idempotent, since the Worker runs it again.
 */
export function scrubMessage(text: string): string {
  let out = text.replace(/\s+/g, ' ');
  for (const [pattern, placeholder] of SCRUBS) out = out.replace(pattern, placeholder);
  return out.slice(0, WIRE.maxMessage).trim();
}

const FRAME = /^ {4}at (.+?)(?: \((native)\)?| \((address at )?(.*?):(\d+):(\d+)\))$/;
const PART_MAX = 60;

/** ASCII only, so 50 frames stay under the Worker's 8 KB, and no digit run a computed function name could carry. */
function framePart(text: string): string {
  return text.replace(/[^\w$.<>-]/g, '').replace(/\d{5,}/g, '').slice(0, PART_MAX) || '?';
}

function basename(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  return framePart(path.slice(path.lastIndexOf('/') + 1));
}

/** Frame lines only; the message lines, component stacks and "skipping N frames" lines are left out. */
export function parseHermesStack(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of stack.split('\n')) {
    const m = FRAME.exec(line);
    if (m === null) continue;
    const fn = framePart(m[1] ?? '');
    frames.push(m[2] === 'native' ? [fn, 'native', 0, 0] : [fn, basename(m[4] ?? ''), Number(m[5]), Number(m[6])]);
    if (frames.length === WIRE.maxFrames) break;
  }
  return frames;
}

function errorName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[^A-Za-z0-9_$.]/g, '').slice(0, 60) : '';
  return name || 'Error';
}

/** A getter that throws or a value with no string form reads as nothing, so building a report never throws. */
function read<T>(get: () => unknown, as: (value: unknown) => T, fallback: T): T {
  try {
    return as(get());
  } catch {
    return fallback;
  }
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
  const text = (value: unknown): string => scrubMessage(String(value));
  const stack = error ? read(() => error.stack, (v) => (typeof v === 'string' ? v : ''), '') : '';
  return {
    t: at.t,
    source: at.source,
    fatal: at.fatal,
    code: at.code ?? null,
    name: error ? read(() => error.name, errorName, 'Error') : 'NonError',
    message: read(() => (error ? error.message : thrown), text, ''),
    screen: at.screen,
    frames: parseHermesStack(stack),
  };
}

/** What the Worker hashes into the group fingerprint: build-independent parts only, never frame offsets. */
export function fingerprintSource(report: Pick<ErrorReport, 'source' | 'name' | 'message' | 'code' | 'screen'>): string {
  return [report.source, report.name, scrubMessage(report.message), report.code ?? '', report.screen].join('|');
}
