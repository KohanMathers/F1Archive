import { createPool, migrate } from '@f1archive/db';
import { runIngest } from './ingest/ingest.js';
import { notifySite } from './notify.js';
import { fetchRadio, scanRadio } from './radio.js';
import { runExportWorker } from './export/run.js';

const VERSION = process.env.APP_VERSION ?? '0.1.0';

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}
function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith('--')) {
      if (['--years', '--source'].includes(args[i]!)) i++;
      continue;
    }
    out.push(args[i]!);
  }
  return out;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const radioDir = process.env.RADIO_DIR ?? '/data/radio';
  const exportDir = process.env.EXPORT_DIR ?? '/data/exports';

  switch (cmd) {
    case 'migrate': {
      const pool = createPool({ max: 1 });
      await migrate(pool);
      await pool.end();
      return;
    }
    case 'ingest': {
      const source = option(args, '--source') ?? process.env.SOURCE_DB ?? '/data/source/f1-telem.db';
      const years = option(args, '--years')?.split(',').map(Number);
      await runIngest({ source, force: flag(args, '--force'), skipTelemetry: flag(args, '--no-telemetry'), years, appVersion: VERSION });
      if (flag(args, '--no-radio-scan')) console.log('[radio] scan skipped (--no-radio-scan): run `worker radio-scan` where the recordings are.');
      else await scanRadio(radioDir).catch((e) => console.warn(`[radio] scan skipped: ${(e as Error).message}`));
      await notifySite();
      return;
    }
    case 'radio-scan':
      await scanRadio(radioDir);
      await notifySite();
      return;
    case 'radio-fetch':
      await fetchRadio({ radioDir, only: positional(args), delayMs: Number(process.env.RADIO_FETCH_DELAY_MS ?? 150) });
      await notifySite();
      return;
    case 'exports':
    case 'serve': {
      if (cmd === 'serve') {
        const pool = createPool({ max: 1 });
        await migrate(pool);
        await pool.end();
      }
      await runExportWorker({
        exportDir,
        concurrency: Number(process.env.EXPORT_CONCURRENCY ?? 1),
        ttlHours: Number(process.env.EXPORT_TTL_HOURS ?? 48),
      });
      return;
    }
    default:
      console.log(`F1Archive worker ${VERSION}
Commands:
  migrate
  ingest [--force] [--no-telemetry] [--no-radio-scan] [--years 2021,2022] [--source PATH]
  radio-scan
  radio-fetch [2021 | 2021-abu-dhabi | 2021-abu-dhabi-race ...]
  exports
  serve`);
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
