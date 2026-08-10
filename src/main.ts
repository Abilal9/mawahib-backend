import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { describeEnvPresence, type Env } from './config/env.schema';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  const envSnapshot: Env = {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    PORT: config.get('PORT', { infer: true }),
    CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
    SUPABASE_PROJECT_ID: config.get('SUPABASE_PROJECT_ID', { infer: true }),
    SUPABASE_URL: config.get('SUPABASE_URL', { infer: true }),
    SUPABASE_PUBLISHABLE_KEY: config.get('SUPABASE_PUBLISHABLE_KEY', {
      infer: true,
    }),
    SUPABASE_SECRET_KEY: config.get('SUPABASE_SECRET_KEY', { infer: true }),
    DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
    SUPABASE_JWT_SECRET: config.get('SUPABASE_JWT_SECRET', { infer: true }),
    SUPABASE_JWT_JWKS_URL: config.get('SUPABASE_JWT_JWKS_URL', { infer: true }),
  };

  for (const line of describeEnvPresence(envSnapshot)) {
    logger.log(line);
  }

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const corsOrigins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`Listening on port ${port}`);
}

void bootstrap();
