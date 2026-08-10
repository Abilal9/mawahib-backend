import { AuthGuard } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

/**
 * Stub JWT auth guard. Wire routes with `@UseGuards(JwtAuthGuard)` once
 * Supabase JWT verification is fully configured.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
