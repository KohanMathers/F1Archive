import { config } from './config.js';
import { buildServer } from './server.js';

const app = await buildServer();
await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    app.log.info(`${sig} received, closing`);
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
