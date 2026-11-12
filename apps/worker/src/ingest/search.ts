import { withTransaction, type Pool } from '@f1archive/db';

export async function rebuildSearchIndex(pool: Pool): Promise<void> {
  await withTransaction(pool, async (c) => {
    await c.query('DELETE FROM search_index');
    await c.query(`
      INSERT INTO search_index (type, title, subtitle, href, terms, weight)
      SELECT 'season', s.year::text || ' season', count(e.id) || ' events', '/seasons/' || s.year, s.year::text || ' season', 3
      FROM seasons s LEFT JOIN events e ON e.year = s.year GROUP BY s.year`);
    await c.query(`
      INSERT INTO search_index (type, title, subtitle, href, terms, weight)
      SELECT 'event', e.year || ' ' || e.name,
             concat_ws(', ', CASE WHEN e.is_testing THEN 'Testing' ELSE 'Round ' || e.round END, e.circuit_short_name, e.location, e.country),
             '/seasons/' || e.year || '/' || e.slug,
             concat_ws(' ', e.year, e.name, e.official_name, e.location, e.country, e.circuit_short_name), 2
      FROM events e`);
    await c.query(`
      INSERT INTO search_index (type, title, subtitle, href, terms, weight)
      SELECT 'session', e.year || ' ' || e.name || ', ' || s.source_name,
             concat_ws(', ', s.status, e.circuit_short_name),
             '/seasons/' || e.year || '/' || e.slug || '/' || s.slug,
             concat_ws(' ', e.year, e.name, e.location, s.source_name), 1
      FROM sessions s JOIN events e ON e.id = s.event_id`);
    await c.query(`
      INSERT INTO search_index (type, title, subtitle, href, terms, weight)
      SELECT 'driver', coalesce(rd.given_name || ' ' || rd.family_name, max(sd.full_name)),
             concat_ws(', ', max(sd.abbreviation), min(e.year) || '–' || max(e.year), rd.nationality),
             '/drivers/' || sd.driver_id,
             concat_ws(' ', rd.given_name, rd.family_name, max(sd.full_name), max(sd.abbreviation), rd.permanent_number, sd.driver_id), 4
      FROM session_drivers sd
      JOIN sessions s ON s.id = sd.session_id JOIN events e ON e.id = s.event_id
      LEFT JOIN ref_drivers rd ON rd.driver_id = sd.driver_id
      WHERE sd.driver_id IS NOT NULL
      GROUP BY sd.driver_id, rd.given_name, rd.family_name, rd.nationality, rd.permanent_number`);
    await c.query(`
      INSERT INTO search_index (type, title, subtitle, href, terms, weight)
      SELECT 'circuit', max(circuit_short_name), concat_ws(', ', max(location), max(country), count(*) || ' events'),
             '/circuits/' || circuit_key, concat_ws(' ', max(circuit_short_name), max(location), max(country)), 2
      FROM events WHERE circuit_key IS NOT NULL AND circuit_short_name IS NOT NULL GROUP BY circuit_key`);
    await c.query(`
      INSERT INTO search_index (type, title, subtitle, href, terms, weight)
      SELECT 'constructor', coalesce(rc.name, tn.constructor_id),
             concat_ws(', ', min(tn.year) || '–' || max(tn.year), rc.nationality),
             '/teams/' || tn.constructor_id,
             concat_ws(' ', rc.name, tn.constructor_id, string_agg(DISTINCT tn.team_name, ' ')), 3
      FROM team_names tn LEFT JOIN ref_constructors rc ON rc.constructor_id = tn.constructor_id
      WHERE tn.constructor_id IS NOT NULL GROUP BY tn.constructor_id, rc.name, rc.nationality`);
  });
}
