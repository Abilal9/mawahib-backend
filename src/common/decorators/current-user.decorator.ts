import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Stub decorator for the authenticated user payload attached by JwtStrategy.
 * Usage: `@CurrentUser() user: JwtPayload`
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: unknown }>();
    return request.user;
  },
);
