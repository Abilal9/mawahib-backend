import {
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllExceptionsFilter } from './all-exceptions.filter';
import {
  logRoute,
  publicErrorPath,
  railwayRequestId,
  redactDiagnosticText,
  releaseIdentifier,
  safePublicServerMessage,
} from './unexpected-error-log';

describe('unexpected error diagnostics', () => {
  const originalSha = process.env.RAILWAY_GIT_COMMIT_SHA;

  afterEach(() => {
    if (originalSha === undefined) {
      delete process.env.RAILWAY_GIT_COMMIT_SHA;
    } else {
      process.env.RAILWAY_GIT_COMMIT_SHA = originalSha;
    }
    jest.restoreAllMocks();
  });

  it('drops query strings and collapses ids in the log route', () => {
    const url =
      '/api/v1/media/11111111-1111-4111-8111-111111111111?token=secret-token';
    expect(publicErrorPath(url)).toBe(
      '/api/v1/media/11111111-1111-4111-8111-111111111111',
    );
    expect(logRoute(url)).toBe('/api/v1/media/:param');
    expect(logRoute('/api/v1/users/hunter2@example.com')).toBe(
      '/api/v1/users/:param',
    );
  });

  it('accepts only a bounded Railway request id and a full commit sha', () => {
    expect(
      railwayRequestId({ 'x-railway-request-id': 'oUj24ZgsTn-86k4Q21mRUA' }),
    ).toBe('oUj24ZgsTn-86k4Q21mRUA');
    expect(
      railwayRequestId({
        'x-railway-request-id': 'postgres://user:password@host/db',
      }),
    ).toBeUndefined();
    expect(railwayRequestId({ 'x-request-id': 'client-supplied' })).toBeUndefined();
    expect(
      releaseIdentifier({
        RAILWAY_GIT_COMMIT_SHA: '51bf1151c26022526f346bc06e5ba0a23fd3d220',
      }),
    ).toBe('51bf1151c26022526f346bc06e5ba0a23fd3d220');
    expect(
      releaseIdentifier({ RAILWAY_GIT_COMMIT_SHA: 'https://secret.example/token' }),
    ).toBeUndefined();
  });

  it('redacts urls, bearer tokens, and assignments without keeping the secret', () => {
    const text = redactDiagnosticText(
      'failed postgres://app:super-secret@db.internal:5432/mawahib Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature password=hunter2 otp=123456',
      500,
    );
    expect(text).not.toContain('super-secret');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('123456');
    expect(text).not.toContain('eyJhbGci');
    expect(text).toContain('[redacted-url]');
    expect(text).toContain('Bearer [redacted]');
    expect(text).toContain('password=[redacted]');
    const json = redactDiagnosticText(
      '{"password":"hunter2","token":"raw-token"}',
      200,
    );
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('raw-token');
  });

  it('returns only an application-owned server message', () => {
    expect(safePublicServerMessage('Account status could not be verified.')).toBe(
      'Account status could not be verified.',
    );
    expect(safePublicServerMessage('hunter2')).toBe('Internal server error');
    expect(safePublicServerMessage('API key abc123')).toBe('Internal server error');
    expect(
      safePublicServerMessage('connect postgres://app:secret@db/app failed'),
    ).toBe('Internal server error');
  });

  it('logs a 500 without the query, token, or thrown object contents', () => {
    process.env.RAILWAY_GIT_COMMIT_SHA =
      '51bf1151c26022526f346bc06e5ba0a23fd3d220';
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const body = invoke(
      Object.assign(new Error('postgres://app:secret@db/app'), {
        password: 'hunter2',
      }),
      '/api/v1/users/me?access_token=secret-token',
      { 'x-railway-request-id': 'req-12345678' },
    );

    expect(body.message).toBe('Internal server error');
    expect(body.path).toBe('/api/v1/users/me');
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('route=/api/v1/users/me');
    expect(logged).toContain('status=500');
    expect(logged).toContain('requestId=req-12345678');
    expect(logged).toContain('release=51bf1151c26022526f346bc06e5ba0a23fd3d220');
    expect(logged).not.toContain('secret-token');
    expect(logged).not.toContain('secret@db');
    expect(logged).not.toContain('hunter2');
  });

  it('omits free-text secrets, unsafe error names, and provider 503 text', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const leaked = new Error('customer credential hunter2');
    leaked.name = 'Credential hunter2';
    leaked.stack = [
      'Credential hunter2: customer credential hunter2',
      '    at parser (huntertwo)',
      '    at parser ({"otp":123456})',
      '    at work (/app/src/payments.ts:10:4)',
    ].join('\n');
    invoke(leaked, '/api/v1/payments');
    const provider = invoke(
      new ServiceUnavailableException('API key abc123'),
      '/api/v1/media/upload',
    );

    expect(provider.message).toBe('Internal server error');
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('huntertwo');
    expect(logged).not.toContain('123456');
    expect(logged).not.toContain('abc123');
    expect(logged).toContain('error=Error');
    expect(logged).toContain('payments.ts');
  });

  it('does not log an expected 401 or 429', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    invoke(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), '/api/v1/users/me');
    invoke(
      new HttpException(
        { message: 'Too many requests', retryAfter: 2 },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      '/api/v1/public/job-listings?take=1',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('does not serialize a thrown credential object', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    invoke(
      { password: 'hunter2', token: 'raw-token', url: 'https://signed.example/file' },
      '/api/v1/media',
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('error=NonError');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('raw-token');
    expect(logged).not.toContain('signed.example');
  });
});

function invoke(
  exception: unknown,
  url: string,
  headers: Record<string, string> = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      Object.assign(body, payload);
    },
  };
  const request = { method: 'GET', url, headers } as Request;
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response as unknown as Response,
    }),
  } as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return body;
}
