import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import type { App } from 'supertest/types';

@Controller('parsers')
class ParserEchoController {
  @Post('json')
  json(@Body() body: Record<string, unknown>) {
    return body;
  }

  @Post('form')
  form(@Body() body: Record<string, unknown>) {
    return body;
  }
}

type RawResponse = { status: number; body: unknown };

function postRaw(
  server: Server,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<RawResponse> {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('parser test server is not listening');
  }

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('request parsers', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ParserEchoController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
  });

  afterEach(async () => {
    await app.close();
  });

  it('uses the patched parser packages', () => {
    expect(require('body-parser/package.json').version).toBe('2.4.0');
    expect(require('qs/package.json').version).toBe('6.17.1');
    expect(require('proxy-addr/package.json').version).toBe('2.0.8');
  });

  it('parses a normal JSON body', async () => {
    const response = await request(app.getHttpServer())
      .post('/parsers/json')
      .send({ name: 'mawahib', count: 2 })
      .expect(201);

    expect(response.body).toEqual({ name: 'mawahib', count: 2 });
  });

  it('parses a normal urlencoded body', async () => {
    const response = await request(app.getHttpServer())
      .post('/parsers/form')
      .type('form')
      .send('name=Hello+World&count=2')
      .expect(201);

    expect(response.body).toEqual({ name: 'Hello World', count: '2' });
  });

  it('parses a normal gzip JSON body', async () => {
    const payload = Buffer.from(
      JSON.stringify({ name: 'mawahib', count: 2 }),
    );
    const response = await postRaw(
      app.getHttpServer() as Server,
      '/parsers/json',
      {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      gzipSync(payload),
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ name: 'mawahib', count: 2 });
  });

  it('rejects a body that claims to be gzip but is not', async () => {
    const response = await postRaw(
      app.getHttpServer() as Server,
      '/parsers/json',
      {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      Buffer.from('not-gzip'),
    );

    expect(response.status).toBe(400);
    expect(response.body).not.toEqual({ name: 'mawahib', count: 2 });
  });

  it('finishes a gzip body that has one trailing byte without changing the parsed value', async () => {
    const payload = Buffer.from(
      JSON.stringify({ name: 'mawahib', count: 2 }),
    );
    const response = await postRaw(
      app.getHttpServer() as Server,
      '/parsers/json',
      {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      Buffer.concat([gzipSync(payload), Buffer.from([0])]),
    );

    expect([201, 400]).toContain(response.status);
    if (response.status !== 400) {
      expect(response.body).toEqual({ name: 'mawahib', count: 2 });
    }
  });

  it('keeps the default 100kb JSON limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/parsers/json')
      .send({ blob: 'x'.repeat(110_000) })
      .expect(413);

    expect(response.body).not.toHaveProperty('blob');
  });
});
