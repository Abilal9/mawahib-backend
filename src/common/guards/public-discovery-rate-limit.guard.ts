import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PUBLIC_DISCOVERY_RATE_LIMIT_KEY } from '../decorators/public-discovery-rate-limit.decorator';
import { resolveClientKey } from '../rate-limit/public-client-address';
import {
  PublicDiscoveryBudget,
  PublicRateLimitLogPump,
} from '../rate-limit/public-discovery-budget';
import {
  PUBLIC_RATE_LIMIT_CLOCK,
  PUBLIC_RATE_LIMIT_MESSAGE,
  PUBLIC_RATE_LOG_INTERVAL_MS,
} from '../rate-limit/public-rate-limit.constants';
import type { Env } from '../../config/env.schema';

@Injectable()
export class PublicDiscoveryRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(PublicDiscoveryRateLimitGuard.name);
  private readonly budget: PublicDiscoveryBudget;
  private readonly pump: PublicRateLimitLogPump;
  private readonly mode: Env['PUBLIC_CLIENT_ADDRESS_MODE'];

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
    @Optional()
    @Inject(PUBLIC_RATE_LIMIT_CLOCK)
    clock?: () => number,
  ) {
    const mode = config.get('PUBLIC_CLIENT_ADDRESS_MODE', { infer: true });
    if (mode !== 'socket' && mode !== 'edge') {
      throw new Error('PUBLIC_CLIENT_ADDRESS_MODE is not configured');
    }
    this.mode = mode;
    this.budget = new PublicDiscoveryBudget({
      capacity: config.get('PUBLIC_RATE_BURST', { infer: true }),
      refillPerSecond: config.get('PUBLIC_RATE_REFILL_PER_SECOND', { infer: true }),
      clock: clock ?? (() => performance.now()),
    });
    this.pump = new PublicRateLimitLogPump(
      () => this.budget.drainWindow(),
      (line) => this.logger.log(line),
      PUBLIC_RATE_LOG_INTERVAL_MS,
    );
    this.pump.start();
  }

  onModuleDestroy(): void {
    this.pump.stop();
  }

  canActivate(context: ExecutionContext): boolean {
    const limited =
      this.reflector.getAllAndOverride<boolean>(PUBLIC_DISCOVERY_RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    if (!limited) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'OPTIONS') return true;

    const identity = resolveClientKey(this.mode, {
      remoteAddress: request.socket?.remoteAddress,
      realIpHeader: request.headers['x-real-ip'],
    });
    const decision = this.budget.consume(identity);
    if (decision.allowed) return true;

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: PUBLIC_RATE_LIMIT_MESSAGE,
        retryAfter: decision.retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
