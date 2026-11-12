import type { FeedKey, FeedState } from './feeds.js';
import { isRaceLike } from './ids.js';

export interface GapContext {
  feed: FeedKey;
  state: FeedState;
  year?: number;
  round?: number;
  event?: string;
  session?: string;
  driver?: string;
  missingHalf?: 'car' | 'position';
}

export interface GapExplanation {
  id: string;
  title: string;
  body: string[];
  source: 'archive-documentation' | 'f1-side-research' | 'generic' | 'deployment';
  mayBeFilledLater: boolean;
}

interface Rule extends GapExplanation {
  match: (c: GapContext) => boolean;
}

const is = (c: GapContext, year: number, round: number, sessions?: string[]) =>
  c.year === year && c.round === round && (!sessions || (c.session !== undefined && sessions.includes(c.session)));

const SESSION_FEED = (c: GapContext) => c.feed !== 'circuit_corners' && c.feed !== 'marshal_lights' && c.feed !== 'marshal_sectors';

const RULES: Rule[] = [
  {
    id: 'session-2018-bahrain-early-format',
    title: 'Only the race was published for the 2018 Bahrain Grand Prix',
    body: [
      'F1 moved its timing archive to the current format in early 2018. For the Bahrain weekend only the race was written to the new archive; Practice 1, 2, 3 and Qualifying were never published there.',
      'The sessions still appear in the official schedule, which is why they are listed here.',
    ],
    source: 'f1-side-research',
    mayBeFilledLater: false,
    match: (c) => is(c, 2018, 2, ['Practice 1', 'Practice 2', 'Practice 3', 'Qualifying']) && c.state === 'missing' && SESSION_FEED(c),
  },
  {
    id: 'session-2018-china-fp3',
    title: '2018 Chinese Grand Prix Practice 3 was never archived',
    body: ['F1 never wrote this session to its archive during the same early-2018 changeover that affected Bahrain.'],
    source: 'f1-side-research',
    mayBeFilledLater: false,
    match: (c) => is(c, 2018, 3, ['Practice 3']) && c.state === 'missing' && SESSION_FEED(c),
  },
  {
    id: 'session-2019-japan-fp3-typhoon',
    title: 'This session never took place',
    body: ['Saturday running at Suzuka in 2019, including Practice 3, was cancelled because of Typhoon Hagibis. There is nothing to archive.'],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) => is(c, 2019, 17, ['Practice 3']) && SESSION_FEED(c),
  },
  {
    id: 'session-2021-imola-fp1',
    title: "F1's archive failed to record this session",
    body: ['The archive failed to record 2021 Emilia Romagna Practice 1. Live timing was also down during the broadcast of the session.'],
    source: 'f1-side-research',
    mayBeFilledLater: false,
    match: (c) => is(c, 2021, 2, ['Practice 1']) && c.state === 'missing' && SESSION_FEED(c),
  },
  {
    id: 'session-2021-jeddah-high-speed-test',
    title: 'Not an official session',
    body: [
      'The "High Speed Track Test" before the first Jeddah race was an internal systems check, not an official session. Its archive entry points at F1\'s internal test environment, so there is no public data.',
    ],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) => c.year === 2021 && c.round === 21 && c.session === 'High Speed Track Test',
  },

  {
    id: 'telemetry-none-whole-session',
    title: "F1's archive has no telemetry for this session",
    body: [
      'F1\'s archive has neither car data nor position data for any driver in this session. Laps, results and the other feeds for the session are present.',
    ],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) =>
      c.feed === 'telemetry' &&
      (c.state === 'no_data' || c.state === 'missing') &&
      (is(c, 2018, 2, ['Race']) || is(c, 2018, 12, ['Practice 1', 'Practice 2']) || is(c, 2019, 18, ['Practice 1'])),
  },
  {
    id: 'telemetry-none-single-driver',
    title: "F1's archive has no telemetry for this driver in this session",
    body: [
      'For a handful of driver-sessions F1\'s archive has neither car data nor position data. This is one of them. The driver\'s laps and results are still available.',
    ],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) =>
      c.feed === 'telemetry' &&
      (c.state === 'no_data' || c.state === 'missing') &&
      (is(c, 2020, 4, ['Practice 1']) || is(c, 2022, 18, ['Practice 1']) || is(c, 2022, 19, ['Practice 1'])),
  },
  {
    id: 'telemetry-car-only',
    title: 'Position data was not published for this session',
    body: [
      'F1\'s archive has only the car-data feed (speed, RPM, gear, throttle, brake, DRS) for this session. The position feed (x, y, z) was never published, so cars cannot be placed on the circuit map.',
    ],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) => c.feed === 'telemetry' && (is(c, 2018, 1, ['Race']) || is(c, 2023, 9, ['Practice 1'])),
  },
  {
    id: 'telemetry-position-only',
    title: 'Car data was not published for this session',
    body: [
      'F1\'s archive has only the position feed (x, y, z) for this session. Speed, RPM, gear, throttle, brake and DRS were never published, so there are no telemetry traces, only positions on the map.',
    ],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) => c.feed === 'telemetry' && (is(c, 2018, 3, ['Practice 2']) || is(c, 2018, 19, ['Practice 1'])),
  },

  {
    id: 'circuit-2026-madrid',
    title: 'No circuit data yet for the Madrid circuit',
    body: ['Circuit corners and marshal positions come from MultiViewer, which has no data for the new Madrid circuit yet. They fill in on a later sync once MultiViewer publishes them.'],
    source: 'archive-documentation',
    mayBeFilledLater: true,
    match: (c) => (c.feed === 'circuit_corners' || c.feed === 'marshal_lights' || c.feed === 'marshal_sectors') && c.year === 2026 && c.round === 14,
  },
  {
    id: 'circuit-2026-sepang',
    title: 'No circuit data for Sepang',
    body: ['The 2026 Bahrain Grand Prix was held at Sepang (Kuala Lumpur). MultiViewer, the source of corner and marshal data, has no data for Sepang in any year.'],
    source: 'archive-documentation',
    mayBeFilledLater: true,
    match: (c) => (c.feed === 'circuit_corners' || c.feed === 'marshal_lights' || c.feed === 'marshal_sectors') && c.year === 2026 && c.round === 16,
  },
  {
    id: 'circuit-2020-sakhir-outer',
    title: 'No circuit data for the Sakhir outer layout',
    body: ['MultiViewer returned an empty list for the outer layout used at the 2020 Sakhir Grand Prix.'],
    source: 'archive-documentation',
    mayBeFilledLater: true,
    match: (c) => (c.feed === 'circuit_corners' || c.feed === 'marshal_lights' || c.feed === 'marshal_sectors') && c.year === 2020 && c.round === 16,
  },

  {
    id: 'pit-stops-2021-belgium',
    title: 'No pit stops: the race was run behind the Safety Car',
    body: ['The 2021 Belgian Grand Prix ran a couple of laps behind the Safety Car in heavy rain and was then stopped. No pit stops were recorded.'],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) => c.feed === 'pit_stops' && c.year === 2021 && c.event === 'Belgian Grand Prix' && c.session === 'Race',
  },
  {
    id: 'prediction-before-mid-2019',
    title: 'The championship prediction feed did not exist yet',
    body: ['F1 started publishing the live championship prediction feed in mid-2019. There is none for 2018, 2019 rounds 1-6, or the 2023 season opener.'],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) =>
      (c.feed === 'prediction_drivers' || c.feed === 'prediction_teams') &&
      (c.year === 2018 || (c.year === 2019 && (c.round ?? 99) <= 6) || (c.year === 2023 && c.round === 1)),
  },
  {
    id: 'cancelled-for-weather',
    title: 'Session cancelled for weather',
    body: ['No running took place in this session because of the weather, so there are no laps or best times.'],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) =>
      (c.feed === 'laps' || c.feed === 'best_stats' || c.feed === 'telemetry' || c.feed === 'stints' || c.feed === 'intervals') &&
      ((c.year === 2020 && c.event === 'Styrian Grand Prix' && c.session === 'Practice 3') ||
        (c.year === 2020 && c.event === 'Eifel Grand Prix' && (c.session === 'Practice 1' || c.session === 'Practice 2')) ||
        (c.year === 2021 && c.event === 'Russian Grand Prix' && c.session === 'Practice 3')),
  },
  {
    id: 'weather-2022-test',
    title: 'No weather data for the 2022 pre-season test',
    body: ['F1 did not publish a weather feed for the 2022 pre-season test.'],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) => c.feed === 'weather' && c.year === 2022 && c.round === 0,
  },
  {
    id: 'standings-testing',
    title: 'Testing has no championship standings',
    body: ['Pre-season testing does not count towards the championship, so there are no standings after it.'],
    source: 'archive-documentation',
    mayBeFilledLater: false,
    match: (c) => (c.feed === 'standings_drivers' || c.feed === 'standings_constructors') && c.round === 0,
  },
];

function genericNoData(c: GapContext): GapExplanation {
  const raceOnly = ['pit_stops', 'progress', 'prediction_drivers', 'prediction_teams'] as FeedKey[];
  if (raceOnly.includes(c.feed) && c.session && !isRaceLike(c.session)) {
    return {
      id: 'race-only-feed',
      title: 'Only races and sprints have this data',
      body: ['Pit stops, the lap counter and championship predictions only exist for races (and, for some, sprints). Nothing is expected for this kind of session.'],
      source: 'archive-documentation',
      mayBeFilledLater: false,
    };
  }
  if (c.feed === 'stints' || c.feed === 'intervals' || c.feed === 'telemetry') {
    return {
      id: 'driver-did-not-run',
      title: 'The driver may not have run in this session',
      body: [
        'F1\'s feed answered for this driver but contained nothing. This usually means the driver did not run in the session, for example a driver who did not start a race, or a reserve listed but not used.',
        'The archive cannot tell that apart from F1 never publishing the file.',
      ],
      source: 'archive-documentation',
      mayBeFilledLater: false,
    };
  }
  if (c.feed === 'team_radio') {
    return {
      id: 'no-radio-published',
      title: 'F1 published no team radio for this session',
      body: ['F1 only publishes a selection of team radio clips, and for some sessions none at all. This is common in practice and testing, and across much of 2026.'],
      source: 'archive-documentation',
      mayBeFilledLater: false,
    };
  }
  if (c.feed === 'broadcast_audio' || c.feed === 'broadcast_content') {
    return {
      id: 'no-broadcast-published',
      title: 'F1 did not publish this for the session',
      body: ['The broadcast stream references were not published for this session.'],
      source: 'archive-documentation',
      mayBeFilledLater: false,
    };
  }
  return {
    id: 'generic-no-data',
    title: 'The source had nothing to give',
    body: [
      'The upstream API answered for this session but returned no data for this feed. That covers two cases the archive cannot tell apart: the feed does not apply to this kind of session, or F1 never published the file.',
    ],
    source: 'generic',
    mayBeFilledLater: false,
  };
}

function genericForState(c: GapContext): GapExplanation {
  switch (c.state) {
    case 'no_data':
      return genericNoData(c);
    case 'missing':
      return {
        id: 'generic-missing',
        title: 'This was not retrieved',
        body: [
          'There is no record of this data at all in the archive, not even an "empty" marker. That means the request to the source failed when the archive was last synchronised.',
          'Failed requests are retried on every full sync, so this may fill in later. If it persists across syncs, the source itself most likely does not have it.',
        ],
        source: 'generic',
        mayBeFilledLater: true,
      };
    case 'partial':
      return c.missingHalf === 'car'
        ? {
          id: 'generic-partial-car',
          title: 'Only position data is available',
          body: ['F1\'s archive has the position feed for this driver but not the car-data feed (speed, RPM, gear, throttle, brake, DRS).'],
          source: 'generic',
          mayBeFilledLater: false,
        }
        : {
          id: 'generic-partial-position',
          title: 'Only car data is available',
          body: ['F1\'s archive has the car-data feed for this driver but not the position feed (x, y, z), so the car cannot be shown on the circuit map.'],
          source: 'generic',
          mayBeFilledLater: false,
        };
    case 'not_imported':
      return {
        id: 'deployment-not-imported',
        title: 'Not imported into this deployment',
        body: [
          'The original archive has this data, but this deployment of F1Archive was built from a reduced development subset to keep it small. It is not a gap in the archive.',
        ],
        source: 'deployment',
        mayBeFilledLater: true,
      };
    case 'upcoming':
      return {
        id: 'upcoming',
        title: 'This has not happened yet',
        body: ['The session is scheduled in the future. Data is archived a few hours after a session ends, once F1 marks its archive complete.'],
        source: 'generic',
        mayBeFilledLater: true,
      };
    default:
      return {
        id: 'generic-unknown',
        title: 'No explanation recorded',
        body: ['The archive has no recorded reason for this gap.'],
        source: 'generic',
        mayBeFilledLater: false,
      };
  }
}

export function explainGap(c: GapContext): GapExplanation {
  if (c.state === 'not_imported' || c.state === 'upcoming') return genericForState(c);
  const rule = RULES.find((r) => r.match(c));
  if (rule) {
    const { match: _m, ...exp } = rule;
    return exp;
  }
  return genericForState(c);
}

export function documentedGaps(): GapExplanation[] {
  return RULES.map(({ match: _m, ...exp }) => exp);
}

export const DERIVED_DATA_NOTES = {
  topThreeDerived:
    'For 2018 Austrian and German GP Qualifying F1\'s top-three feed was missing, so the final top three was taken from the results. Those rows have no timestamp or lap state.',
  circuitCopied2018Australia:
    "F1's 2018 index omits the Australian GP, so its circuit data was copied from 2019. The layout did not change.",
  circuitCopied2024:
    "F1's 2024 index omits rounds 1-9 (Bahrain to Canada), so their circuit data was copied from 2023 (China and Emilia Romagna from 2025). Layouts were the same across 2023-2025.",
} as const;
