import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@tesserax/config';
import { createLogger } from '@tesserax/core';
import { AppModule } from './app.module';
import { correlationMiddleware } from './infra/correlation.middleware';
import { allowedHosts, hostGuard } from './infra/host-guard.middleware';
import { PinoNestLogger } from './infra/nest-logger';

const log = createLogger('main');

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger() });
  // before every route: refuse requests addressed to a name we do not serve (DNS rebinding)
  app.use(hostGuard(allowedHosts(config)));
  app.use(correlationMiddleware);
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableShutdownHooks();
  // Local mode: loopback only, no login.
  await app.listen(config.API_PORT, config.API_HOST);
  log.info(`API on http://${config.API_HOST}:${config.API_PORT}`);
}

bootstrap().catch(err => {
  log.fatal({ err }, 'failed to start');
  process.exit(1);
});
