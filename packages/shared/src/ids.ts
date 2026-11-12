export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const TESTING_RE = /\((testing-(\d+))\)\s*$/i;

export function eventSlug(sourceEventName: string): string {
  const testing = TESTING_RE.exec(sourceEventName);
  if (testing) return `pre-season-testing-${testing[2]}`;
  const base = sourceEventName.replace(/\s+Grand Prix\s*$/i, '');
  return slugify(base) || slugify(sourceEventName);
}

export function isTestingEvent(sourceEventName: string, round: number): boolean {
  return round === 0 || TESTING_RE.test(sourceEventName);
}

export function sessionSlug(sourceSessionName: string): string {
  return slugify(sourceSessionName);
}

export function eventKey(year: number, slug: string): string {
  return `${year}-${slug}`;
}

export function sessionKey(year: number, evSlug: string, sesSlug: string): string {
  return `${year}-${evSlug}-${sesSlug}`;
}

export type SessionKind =
  | 'practice'
  | 'qualifying'
  | 'sprint-qualifying'
  | 'sprint'
  | 'race'
  | 'testing'
  | 'other';

export function sessionKind(sourceSessionName: string): SessionKind {
  const n = sourceSessionName.toLowerCase();
  if (n.startsWith('practice')) return 'practice';
  if (n === 'qualifying') return 'qualifying';
  if (n === 'sprint qualifying' || n === 'sprint shootout') return 'sprint-qualifying';
  if (n === 'sprint') return 'sprint';
  if (n === 'race') return 'race';
  if (n.startsWith('day ')) return 'testing';
  return 'other';
}

export function isRaceLike(sourceSessionName: string): boolean {
  const k = sessionKind(sourceSessionName);
  return k === 'race' || k === 'sprint';
}

export function sprintQualifyingWasARace(year: number, sourceSessionName: string): boolean {
  return year === 2021 && sourceSessionName === 'Sprint Qualifying';
}

export function parseDriverNumber(text: string): number {
  if (!/^\d{1,5}$/.test(text)) {
    throw new Error(`Unexpected driver number ${JSON.stringify(text)}`);
  }
  return Number(text);
}
