/**
 * Bandcamp's own JSON read back out of the HTML attribute it was inlined into (`data-tralbum`, `data-band`,
 * `#pagedata`'s `data-blob`), untouched on its way to a Raw Document (ADR-0004).
 */

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&quot;': '"',
  '&#34;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:quot|apos|lt|gt|amp|#34|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

/** Undefined when absent, null when not JSON; matched whole, so `data-tralbum-collect-info` never answers. */
export function readJsonAttribute(html: string, attribute: string, id?: string): unknown {
  const pattern =
    id === undefined
      ? new RegExp(`\\sdata-${attribute}="([^"]*)"`)
      : new RegExp(`id="${id}"[^>]*\\sdata-${attribute}="([^"]*)"`);
  const match = pattern.exec(html);
  if (match?.[1] === undefined) return undefined;
  try {
    return JSON.parse(decodeHtmlEntities(match[1])) as unknown;
  } catch {
    return null;
  }
}
