import { describe, expect, it } from 'vitest';
import {
  cumulativeDistance,
  distanceDelta,
  eventSlug,
  explainGap,
  formatLapTime,
  formatSessionTime,
  interpolateAt,
  lapTrace,
  lowerIndex,
  minMaxDecimate,
  normaliseColour,
  parseDriverNumber,
  sessionKind,
  sessionSlug,
} from '../src/index.js';

describe('identifiers', () => {
  it('slugs event names deterministically', () => {
    expect(eventSlug('Abu Dhabi Grand Prix')).toBe('abu-dhabi');
    expect(eventSlug('São Paulo Grand Prix')).toBe('sao-paulo');
    expect(eventSlug('70th Anniversary Grand Prix')).toBe('70th-anniversary');
    expect(eventSlug('Pre-Season Testing (testing-1)')).toBe('pre-season-testing-1');
    expect(eventSlug('Pre-Season Test (testing-1)')).toBe('pre-season-testing-1');
    expect(eventSlug('Pre-Season Testing (testing-2)')).toBe('pre-season-testing-2');
  });
  it('slugs session names', () => {
    expect(sessionSlug('Practice 1')).toBe('practice-1');
    expect(sessionSlug('Sprint Qualifying')).toBe('sprint-qualifying');
    expect(sessionSlug('High Speed Track Test')).toBe('high-speed-track-test');
  });
  it('classifies sessions', () => {
    expect(sessionKind('Sprint Shootout')).toBe('sprint-qualifying');
    expect(sessionKind('Day 2')).toBe('testing');
    expect(sessionKind('Race')).toBe('race');
  });
  it('parses driver numbers strictly, keeping odd source values', () => {
    expect(parseDriverNumber('44')).toBe(44);
    expect(parseDriverNumber('65535')).toBe(65535);
    expect(() => parseDriverNumber('VER')).toThrow();
  });
});

describe('formatting', () => {
  it('formats lap times from nanoseconds', () => {
    expect(formatLapTime(86_103_000_000)).toBe('1:26.103');
    expect(formatLapTime(58_204_000_000)).toBe('58.204');
    expect(formatLapTime(null)).toBe('—');
  });
  it('formats session clock', () => {
    expect(formatSessionTime(3_741_871_000_000)).toBe('1:02:21.9');
  });
  it('normalises colours', () => {
    expect(normaliseColour('0600ef')).toBe('#0600EF');
    expect(normaliseColour('')).toBeNull();
    expect(normaliseColour('nope')).toBeNull();
  });
});

describe('gap explanations', () => {
  it('uses documented reasons when they match', () => {
    const e = explainGap({ feed: 'laps', state: 'missing', year: 2018, round: 2, session: 'Qualifying' });
    expect(e.id).toBe('session-2018-bahrain-early-format');
    expect(explainGap({ feed: 'telemetry', state: 'no_data', year: 2018, round: 2, session: 'Race', driver: '44' }).id).toBe(
      'telemetry-none-whole-session',
    );
    expect(explainGap({ feed: 'telemetry', state: 'partial', year: 2018, round: 1, session: 'Race', missingHalf: 'position' }).id).toBe(
      'telemetry-car-only',
    );
  });
  it('never presents a deployment subset as an archive gap', () => {
    const e = explainGap({ feed: 'telemetry', state: 'not_imported', year: 2018, round: 2, session: 'Race' });
    expect(e.source).toBe('deployment');
  });
  it('explains race-only feeds in practice', () => {
    expect(explainGap({ feed: 'pit_stops', state: 'no_data', year: 2022, round: 3, session: 'Practice 1' }).id).toBe('race-only-feed');
  });
  it('falls back to a generic explanation', () => {
    expect(explainGap({ feed: 'weather', state: 'missing', year: 2024, round: 5, session: 'Race' }).id).toBe('generic-missing');
  });
});

describe('telemetry math', () => {
  it('finds lower indices', () => {
    const a = [0, 10, 20, 30];
    expect(lowerIndex(a, -1)).toBe(-1);
    expect(lowerIndex(a, 0)).toBe(0);
    expect(lowerIndex(a, 15)).toBe(1);
    expect(lowerIndex(a, 99)).toBe(3);
  });
  it('interpolates and refuses across gaps and nulls', () => {
    const ts = [0, 10, 20, 100];
    const v = [0, 10, null, 100];
    expect(interpolateAt(ts, v, 5)).toBe(5);
    expect(interpolateAt(ts, v, 15)).toBeNull();
    expect(interpolateAt([0, 10, 100], [0, 10, 100], 50, 20)).toBeNull();
    expect(interpolateAt(ts, v, -1)).toBeNull();
  });
  it('integrates distance from speed', () => {
    const d = cumulativeDistance([0, 1e9, 2e9], [36, 36, 36]);
    expect(d[2]).toBeCloseTo(20);
    const withNull = cumulativeDistance([0, 1e9, 2e9], [36, null, 36]);
    expect(withNull[2]).toBeCloseTo(20);
  });
  it('computes a distance delta between laps', () => {
    const a = lapTrace([0, 1e9, 2e9], [36, 36, 36], 0);
    const b = lapTrace([0, 1e9, 2e9, 3e9, 4e9], [18, 18, 18, 18, 18], 0);
    const delta = distanceDelta(a, b);
    expect(delta[0]).toBeCloseTo(0);
    expect(delta[1]).toBeCloseTo(1);
    expect(delta[2]).toBeCloseTo(2);
  });
  it('decimates keeping extremes', () => {
    const v = Array.from({ length: 1000 }, (_, i) => (i === 503 ? 999 : i % 7));
    const idx = minMaxDecimate(v, 50);
    expect(idx).toContain(503);
    expect(idx.length).toBeLessThanOrEqual(100);
  });
});
