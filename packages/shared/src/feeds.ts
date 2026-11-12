export type FeedScope = 'season' | 'event' | 'session' | 'driver';

export type FeedState = 'present' | 'partial' | 'no_data' | 'missing' | 'not_imported' | 'upcoming';

export interface FeedDef {
  key: FeedKey;
  label: string;
  scope: FeedScope;
  sourceTable: string;
  description: string;
  allSessionTypes?: boolean;
}

export const FEEDS = {
  season_teams: { key: 'season_teams', label: 'Team colours', scope: 'season', sourceTable: 't_season_teams', description: 'Team names and the colours used for that season.' },
  season_compounds: { key: 'season_compounds', label: 'Tyre compounds', scope: 'season', sourceTable: 't_season_compounds', description: 'Tyre compound names used in the season.' },
  event_info: { key: 'event_info', label: 'Event information', scope: 'event', sourceTable: 't_event_info', description: 'Event name, location, format and circuit.' },
  circuit_corners: { key: 'circuit_corners', label: 'Circuit corners', scope: 'event', sourceTable: 't_event_circuit_corners', description: 'Corner numbers and positions in the telemetry coordinate system.' },
  marshal_lights: { key: 'marshal_lights', label: 'Marshal lights', scope: 'event', sourceTable: 't_event_circuit_marshal_lights', description: 'Marshal light panel positions.' },
  marshal_sectors: { key: 'marshal_sectors', label: 'Marshal sectors', scope: 'event', sourceTable: 't_event_circuit_marshal_sectors', description: 'Marshal sector boundaries.' },
  standings_drivers: { key: 'standings_drivers', label: "Drivers' standings", scope: 'event', sourceTable: 't_event_standings_drivers', description: "Drivers' championship standings after the event." },
  standings_constructors: { key: 'standings_constructors', label: "Constructors' standings", scope: 'event', sourceTable: 't_event_standings_constructors', description: "Constructors' championship standings after the event." },
  session_info: { key: 'session_info', label: 'Session information', scope: 'session', sourceTable: 't_session_info', description: 'Session name, schedule and archive path.' },
  drivers: { key: 'drivers', label: 'Drivers', scope: 'session', sourceTable: 't_session_drivers', description: 'Drivers who took part, with team and colour.' },
  results: { key: 'results', label: 'Results', scope: 'session', sourceTable: 't_session_results', description: 'Classification, grid, points and status.' },
  laps: { key: 'laps', label: 'Lap timing', scope: 'session', sourceTable: 't_session_laps', description: 'Lap and sector times, speed traps, pit in/out and position.' },
  best_stats: { key: 'best_stats', label: 'Best times', scope: 'session', sourceTable: 't_session_best_stats', description: 'Personal best laps, sectors and speed traps.' },
  pit_stops: { key: 'pit_stops', label: 'Pit stops', scope: 'session', sourceTable: 't_session_pit_stops', description: 'Pit stop lap, number and duration.', allSessionTypes: false },
  progress: { key: 'progress', label: 'Lap count', scope: 'session', sourceTable: 't_session_progress', description: 'Race lap counter through the session.', allSessionTypes: false },
  weather: { key: 'weather', label: 'Weather', scope: 'session', sourceTable: 't_session_weather', description: 'Air and track temperature, humidity, pressure, wind and rainfall.' },
  track_status: { key: 'track_status', label: 'Track status', scope: 'session', sourceTable: 't_session_track_status', description: 'Green, yellow, safety car, VSC and red flag periods.' },
  status_events: { key: 'status_events', label: 'Session status', scope: 'session', sourceTable: 't_session_status_events', description: 'Session started, finished, finalised and similar.' },
  clock: { key: 'clock', label: 'Session clock', scope: 'session', sourceTable: 't_session_clock', description: 'Time remaining on the session clock.' },
  race_control: { key: 'race_control', label: 'Race control', scope: 'session', sourceTable: 't_session_race_control_messages', description: 'Race control messages: flags, penalties, investigations and notices.' },
  team_radio: { key: 'team_radio', label: 'Team radio', scope: 'session', sourceTable: 't_session_team_radio', description: 'Team radio clips published by F1, with timestamps.' },
  top_three: { key: 'top_three', label: 'Top three', scope: 'session', sourceTable: 't_session_top_three', description: 'Final top three as shown on the timing screens.' },
  prediction_drivers: { key: 'prediction_drivers', label: 'Championship prediction (drivers)', scope: 'session', sourceTable: 't_session_championship_prediction_drivers', description: 'Live championship prediction at the end of the race.', allSessionTypes: false },
  prediction_teams: { key: 'prediction_teams', label: 'Championship prediction (teams)', scope: 'session', sourceTable: 't_session_championship_prediction_teams', description: 'Live constructors prediction at the end of the race.', allSessionTypes: false },
  broadcast_audio: { key: 'broadcast_audio', label: 'Broadcast audio', scope: 'session', sourceTable: 't_session_broadcast_audio', description: 'Broadcast commentary stream references.' },
  broadcast_content: { key: 'broadcast_content', label: 'Broadcast content', scope: 'session', sourceTable: 't_session_broadcast_content', description: 'Broadcast content stream references.' },
  intervals: { key: 'intervals', label: 'Intervals', scope: 'driver', sourceTable: 't_driver_intervals', description: 'Gap to leader and car ahead through the session.' },
  stints: { key: 'stints', label: 'Tyre stints', scope: 'driver', sourceTable: 't_driver_stints', description: 'Tyre compound, age and stint number.' },
  driver_reference: { key: 'driver_reference', label: 'Driver details', scope: 'driver', sourceTable: 't_driver_reference', description: 'Driver reference details (stored against races only).' },
  telemetry: { key: 'telemetry', label: 'Telemetry', scope: 'driver', sourceTable: 'telemetry', description: 'Car data (speed, RPM, gear, throttle, brake, DRS) and position (x, y, z).' },
} as const satisfies Record<string, Omit<FeedDef, 'key'> & { key: string }>;

export type FeedKey = keyof typeof FEEDS;

export const FEED_KEYS = Object.keys(FEEDS) as FeedKey[];

export function feedDef(key: FeedKey): FeedDef {
  return FEEDS[key] as FeedDef;
}

export function isFeedKey(k: string): k is FeedKey {
  return Object.prototype.hasOwnProperty.call(FEEDS, k);
}

export const TRACK_STATUS: Record<string, { label: string; tone: 'green' | 'yellow' | 'sc' | 'vsc' | 'red' }> = {
  '1': { label: 'Track clear', tone: 'green' },
  '2': { label: 'Yellow flag', tone: 'yellow' },
  '4': { label: 'Safety Car', tone: 'sc' },
  '5': { label: 'Red flag', tone: 'red' },
  '6': { label: 'Virtual Safety Car', tone: 'vsc' },
  '7': { label: 'VSC ending', tone: 'vsc' },
};
