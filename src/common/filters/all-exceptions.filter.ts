import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  STAFF_AUTH_UNAVAILABLE,
  STAFF_SCHEMA_NOT_READY,
} from '../auth/admission.codes';
import {
  logRoute,
  publicErrorPath,
  railwayRequestId,
  releaseIdentifier,
  safePublicServerMessage,
  unexpectedErrorDetail,
  unexpectedErrorName,
} from './unexpected-error-log';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const extra =
      exceptionResponse && typeof exceptionResponse === 'object'
        ? exceptionResponse
        : null;
    const detail = (key: string) =>
      extra && key in extra ? (extra as Record<string, unknown>)[key] : undefined;

    const extracted =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : detail('message');
    const message =
      status >= 500
        ? safePublicServerMessage(extracted)
        : extracted !== undefined
          ? extracted
          : 'Internal server error';

    const staffUnavailable =
      status === HttpStatus.SERVICE_UNAVAILABLE &&
      (detail('code') === STAFF_AUTH_UNAVAILABLE ||
        detail('code') === STAFF_SCHEMA_NOT_READY);

    if (status >= 500 && !staffUnavailable) {
      this.logger.error(
        unexpectedErrorLine(request, status, exception),
        unexpectedErrorDetail(exception),
      );
    }

    const retryAfter = detail('retryAfter');
    if (
      typeof retryAfter === 'number' &&
      Number.isSafeInteger(retryAfter) &&
      retryAfter >= 1 &&
      retryAfter <= 60
    ) {
      response.setHeader('Retry-After', String(retryAfter));
    }

    response.status(status).json({
      statusCode: status,
      path: publicErrorPath(request.url),
      timestamp: new Date().toISOString(),
      message,
      ...( (status < 500 || staffUnavailable) && detail('code') !== undefined
        ? { code: detail('code') }
        : {}),
      ...(status < 500 && detail('text') !== undefined
        ? { text: detail('text') }
        : {}),
      ...(status < 500 && detail('skillId') !== undefined
        ? { skillId: detail('skillId') }
        : {}),
      ...(status < 500 && detail('categoryId') !== undefined
        ? { categoryId: detail('categoryId') }
        : {}),
      ...(status < 500 && detail('nameEn') !== undefined
        ? { nameEn: detail('nameEn') }
        : {}),
    });
  }
}

function unexpectedErrorLine(
  request: Request,
  status: number,
  exception: unknown,
): string {
  const fields = [
    'unexpected',
    `method=${request.method}`,
    `route=${logRoute(request.url)}`,
    `status=${status}`,
  ];
  const requestId = railwayRequestId(
    request.headers as Record<string, unknown>,
  );
  if (requestId) {
    fields.push(`requestId=${requestId}`);
  }
  const release = releaseIdentifier();
  if (release) {
    fields.push(`release=${release}`);
  }
  fields.push(`error=${unexpectedErrorName(exception)}`);
  return fields.join(' ');
}
