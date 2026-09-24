import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { app, close } = await createApp(config);
await app.listen({ port: config.port, host: config.host });
console.log(
  `SchemaBoard server on http://${config.host}:${config.port}` +
    (config.webDir ? ' (serving the web app)' : '') +
    (config.github ? ' · GitHub sign-in on' : ''),
);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    void close().then(() => process.exit(0));
  });
