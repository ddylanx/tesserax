import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@ot/config';
import { createLogger } from '@ot/core';
import { AppModule } from './app.module';
import { correlationMiddleware } from './infra/correlation.middleware';
import { PinoNestLogger } from './infra/nest-logger';

const log = createLogger('main');

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger() });
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
