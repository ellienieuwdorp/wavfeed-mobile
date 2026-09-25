/**
 * Sample data ported from the v2 client canvas (docs/design/v2-clients, the
 * script at the bottom). The canvas's CARDS module is OVERLAP here, after the
 * Network Overlap signal it shows; its signal sentence is split into the bold
 * lead and the rest.
 */
import { Platform } from 'react-native';

export type Release = { t: string; a: string; l: string; hue: number; on?: boolean };
export type NewRelease = Release & { fact: string; day: string };
export type BoughtRelease = Release & { buyers: string[]; more?: number };
export type Week<R> = { kind: 'week'; week: string; range?: string; all?: number; rows: R[] };
export type Gap = { kind: 'gap'; text: string };
export type Band = { kind: 'upcoming' } | { kind: 'released' };

export type ReleasesBlock = Band | Week<NewRelease> | Gap;
export type BoughtBlock = Week<BoughtRelease> | Gap;
export type Cover = { t: string; a: string; f: string; hue: number };
export type Overlap = Release & { lead: string; rest: string; buyers: string[] };
export type Quote = { who: string; t: string; a: string; when: string; q: string; hue: number };
export type DeviceKind = 'phone' | 'laptop' | 'browser';
export type Device = { kind: DeviceKind; name: string; facts: string; current?: boolean };

const quietGap = '31 Aug – 13 Sep · two quiet weeks, nothing from your pages';

export const REL: ReleasesBlock[] = [
  { kind: 'upcoming' },
  { kind: 'week', week: 'Later this week', rows: [
    { t: 'Saltwater Variations', a: 'Ines Duarte', l: 'Klangwerk', fact: 'bought by dj_okonkwo', day: 'Fri 25', hue: 110, on: true } ] },
  { kind: 'week', week: 'Next week', range: 'Mon 28 Sep – Sun 4 Oct', rows: [
    { t: 'Harbour Lights Dub', a: 'Meridian Sound System', l: 'Pressure Point', fact: '', day: 'Fri 2', hue: 250 },
    { t: 'Fold Series 13', a: 'Various Artists', l: 'Fold', fact: '', day: 'Thu 1', hue: 60 } ] },
  { kind: 'week', week: 'Week of 12 Oct', rows: [
    { t: 'Chalk Figures (Remixes)', a: 'Ines Duarte', l: 'Klangwerk', fact: 'wishlisted by mara.dj', day: 'Fri 16', hue: 130 } ] },
  { kind: 'released' },
  { kind: 'week', week: 'This week', range: 'Mon 21 – Sun 27 Sep', rows: [
    { t: 'Night Bus Companion', a: 'Aria Vex', l: 'self-released', fact: 'wishlisted by 2 you follow', day: 'Wed 23', hue: 300 },
    { t: 'Distant Loop Systems', a: 'Umlaut Convection', l: 'Klangwerk', fact: 'bought by dj_okonkwo and 1 other', day: 'Tue 22', hue: 200, on: true },
    { t: 'Gullwing VIP', a: 'Sable', l: 'Tempa Nova', fact: '', day: 'Mon 21', hue: 160 } ] },
  { kind: 'week', week: 'Last week', range: 'Mon 14 – Sun 20 Sep', rows: [
    { t: 'Selected Reworks Vol. 3', a: 'Peripheral Vision', l: 'Lobe', fact: 'bought by 3 you follow', day: 'Fri 18', hue: 20 },
    { t: 'Low Tide Tools', a: 'Marrow', l: 'self-released', fact: '', day: 'Thu 17', hue: 80 },
    { t: 'Ferrous', a: 'Kite Season', l: 'Tempa Nova', fact: 'bought by kessler_digs', day: 'Mon 14', hue: 340 } ] },
  { kind: 'gap', text: quietGap },
  { kind: 'week', week: 'Week of 24 Aug', rows: [
    { t: 'Nocturne Ledger', a: 'Hollis Grey', l: 'Lobe', fact: '', day: 'Fri 28', hue: 40 },
    { t: 'Small Hours, Vol. 2', a: 'Various Artists', l: 'Pressure Point', fact: 'bought by mara.dj', day: 'Wed 26', hue: 280 } ] },
];

export const BOUGHT: BoughtBlock[] = [
  { kind: 'week', week: 'Next week', range: 'Mon 28 Sep – Sun 4 Oct', rows: [
    { t: 'Harbour Lights Dub', a: 'Meridian Sound System', l: 'Pressure Point', buyers: ['do', 'kd', 'md'], hue: 250 } ] },
  { kind: 'week', week: 'This week', range: 'Mon 21 – Sun 27 Sep', all: 7, rows: [
    { t: 'Distant Loop Systems', a: 'Umlaut Convection', l: 'Klangwerk', buyers: ['do', 'kd', 'md', 'tb'], more: 1, hue: 200, on: true },
    { t: 'Night Bus Companion', a: 'Aria Vex', l: 'self-released', buyers: ['md', 'ru'], hue: 300 },
    { t: 'Gullwing VIP', a: 'Sable', l: 'Tempa Nova', buyers: ['kd', 'do'], hue: 160 } ] },
  { kind: 'week', week: 'Last week', range: 'Mon 14 – Sun 20 Sep', all: 5, rows: [
    { t: 'Selected Reworks Vol. 3', a: 'Peripheral Vision', l: 'Lobe', buyers: ['do', 'md', 'tb'], hue: 20 },
    { t: 'Ferrous', a: 'Kite Season', l: 'Tempa Nova', buyers: ['kd', 'ru'], hue: 340 },
    { t: 'Low Tide Tools', a: 'Marrow', l: 'self-released', buyers: ['do', 'kd'], hue: 80 } ] },
  { kind: 'gap', text: quietGap },
  { kind: 'week', week: 'Week of 24 Aug', rows: [
    { t: 'Nocturne Ledger', a: 'Hollis Grey', l: 'Lobe', buyers: ['md', 'tb'], hue: 40 } ] },
];

export const COVERS: Cover[] = [
  { t: 'Night Bus Companion', a: 'Aria Vex', f: 'released Wednesday', hue: 300 },
  { t: 'Distant Loop Systems', a: 'Umlaut Convection', f: 'released Tuesday', hue: 200 },
  { t: 'Saltwater Variations', a: 'Ines Duarte', f: 'releases Friday', hue: 110 },
  { t: 'Gullwing VIP', a: 'Sable', f: 'released Monday', hue: 160 },
  { t: 'Low Tide Tools', a: 'Marrow', f: 'released Thu 17 Sep', hue: 80 },
];

export const OVERLAP: Overlap[] = [
  { t: 'Distant Loop Systems', a: 'Umlaut Convection', l: 'Klangwerk', lead: '4 people you follow', rest: ' bought this over the weekend', buyers: ['do', 'kd', 'md', 'tb'], hue: 200, on: true },
  { t: 'Selected Reworks Vol. 3', a: 'Peripheral Vision', l: 'Lobe', lead: 'dj_okonkwo and mara.dj', rest: ' bought this in the past week', buyers: ['do', 'md'], hue: 20 },
  { t: 'Harbour Lights Dub', a: 'Meridian Sound System', l: 'Pressure Point', lead: '3 people you follow', rest: ' bought this in the past two weeks', buyers: ['do', 'kd', 'md'], hue: 250 },
];

export const QUOTES: Quote[] = [
  { who: 'kessler_digs', t: 'Harbour Lights Dub', a: 'Meridian Sound System', when: 'bought Wednesday', q: 'Sounds like the ferry at 5am. Instant.', hue: 250 },
  { who: 'mara.dj', t: 'Ferrous', a: 'Kite Season', when: 'bought Mon 14 Sep', q: 'The closer is the one. Been chasing this since the radio rip.', hue: 340 },
];

export const ACCOUNT = { initials: 'el', name: 'ellie', email: 'ellie@nieuwdorp.me', bandcamp: 'ellie', gathered: 'gathered 12 min ago' };

export const DEVICES: Device[] = [
  { kind: 'phone', name: Platform.OS === 'ios' ? "ellie's iPhone" : 'Pixel 10', facts: 'added 22 Sep · gathered 12 min ago', current: true },
  { kind: 'laptop', name: "ellie's MacBook Pro", facts: 'added 20 Sep · gathered 1h ago' },
  { kind: 'browser', name: 'Firefox · 31 Aug 2026', facts: 'added 31 Aug · gathered 2h ago' },
];
