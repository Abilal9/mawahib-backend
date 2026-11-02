import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';

type SpawnOptions = {
  stdio?: 'inherit' | 'pipe' | 'ignore';
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
};

type SpawnCall = {
  command: string;
  args: string[];
  options: SpawnOptions;
};

type GuardModule = {
  REFUSAL_MESSAGE: string;
  prismaDevInvocation: (userArgs?: string[]) => {
    command: string;
    args: string[];
  };
  runMigrateDev: (options?: {
    env?: NodeJS.ProcessEnv;
    args?: string[];
    command?: string;
    commandArgs?: string[];
    stdio?: SpawnOptions['stdio'];
    spawnImpl?: (
      command: string,
      args: string[],
      options: SpawnOptions,
    ) => EventEmitter;
    writeError?: (text: string) => void;
  }) => Promise<number>;
};

// The guard is plain JavaScript so the package script can run before TypeScript compiles.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const guard = require('../../scripts/migrate-dev.js') as GuardModule;

const scriptPath = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'migrate-dev.js',
);

function refusingSpawn(): {
  calls: SpawnCall[];
  spawnImpl: GuardModule['runMigrateDev'] extends (
    options?: infer _,
  ) => Promise<number>
    ? NonNullable<
        NonNullable<Parameters<GuardModule['runMigrateDev']>[0]>['spawnImpl']
      >
    : never;
} {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return new EventEmitter();
    },
  };
}

describe('prisma migrate dev guard', () => {
  const previousOptIn = process.env.ALLOW_MIGRATE_DEV;

  afterEach(() => {
    if (previousOptIn === undefined) {
      delete process.env.ALLOW_MIGRATE_DEV;
      return;
    }
    process.env.ALLOW_MIGRATE_DEV = previousOptIn;
  });

  it.each([undefined, '', 'false', 'TRUE', '1', ' true', 'true\n'])(
    'refuses opt-in %p before starting a process',
    async (value) => {
      process.env.ALLOW_MIGRATE_DEV = 'true';
      const spawned = refusingSpawn();
      const errors: string[] = [];
      const env: NodeJS.ProcessEnv = {};
      if (value !== undefined) env.ALLOW_MIGRATE_DEV = value;

      const code = await guard.runMigrateDev({
        env,
        args: ['--name', 'must-not-run'],
        spawnImpl: spawned.spawnImpl,
        writeError: (text) => errors.push(text),
      });

      expect(code).toBe(1);
      expect(spawned.calls).toEqual([]);
      expect(errors).toEqual([`${guard.REFUSAL_MESSAGE}\n`]);
    },
  );

  it('forwards arguments to an injected command only when opt-in is exact', async () => {
    const spawned = refusingSpawn();
    const code = await guard.runMigrateDev({
      env: { ALLOW_MIGRATE_DEV: 'true' },
      args: ['--name', 'example', '--create-only'],
      command: process.execPath,
      commandArgs: ['-e', 'process.exit(0)'],
      spawnImpl: (command, args, options) => {
        const child = spawned.spawnImpl(command, args, options);
        process.nextTick(() => child.emit('exit', 0, null));
        return child;
      },
    });

    expect(code).toBe(0);
    expect(spawned.calls).toEqual([
      {
        command: process.execPath,
        args: ['-e', 'process.exit(0)', '--name', 'example', '--create-only'],
        options: {
          stdio: 'inherit',
          env: { ALLOW_MIGRATE_DEV: 'true' },
          shell: false,
        },
      },
    ]);
  });

  it('keeps a failing child status and reports a launch failure without secrets', async () => {
    const failed = refusingSpawn();
    const failure = await guard.runMigrateDev({
      env: { ALLOW_MIGRATE_DEV: 'true', DATABASE_URL: 'postgresql://secret' },
      command: process.execPath,
      commandArgs: ['-e', 'process.exit(7)'],
      spawnImpl: (command, args, options) => {
        const child = failed.spawnImpl(command, args, options);
        process.nextTick(() => child.emit('exit', 7, null));
        return child;
      },
    });
    expect(failure).toBe(7);

    const errors: string[] = [];
    const launch = await guard.runMigrateDev({
      env: {
        ALLOW_MIGRATE_DEV: 'true',
        DATABASE_URL: 'postgresql://user:secret-pass@example/db',
      },
      command: path.join('/tmp', 'mawahib-missing-migrate-bin'),
      commandArgs: ['migrate', 'dev'],
      stdio: 'ignore',
      writeError: (text) => errors.push(text),
    });
    const reported = errors.join('');

    expect(launch).toBe(1);
    expect(reported).toMatch(/^Failed to start Prisma: /);
    expect(reported).not.toContain('secret-pass');
    expect(reported).not.toContain('postgresql://');
    expect(reported).not.toContain('DATABASE_URL');
  });

  it('reports a thrown launch error and a signaled child as failure', async () => {
    const thrown: string[] = [];
    const thrownCode = await guard.runMigrateDev({
      env: { ALLOW_MIGRATE_DEV: 'true' },
      command: process.execPath,
      spawnImpl: () => {
        throw new Error('boom');
      },
      writeError: (text) => thrown.push(text),
    });
    expect(thrownCode).toBe(1);
    expect(thrown).toEqual(['Failed to start Prisma: boom\n']);

    const signaled = await guard.runMigrateDev({
      env: { ALLOW_MIGRATE_DEV: 'true' },
      command: process.execPath,
      spawnImpl: () => {
        const child = new EventEmitter();
        process.nextTick(() => child.emit('exit', null, 'SIGTERM'));
        return child;
      },
    });
    expect(signaled).toBe(1);
  });

  it('points the real invocation at the installed Prisma entry without starting it', () => {
    const invocation = guard.prismaDevInvocation(['--name', 'example']);

    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args[0]).toMatch(
      /[/\\]node_modules[/\\]prisma[/\\]build[/\\]index\.js$/,
    );
    expect(invocation.args.slice(1)).toEqual([
      'migrate',
      'dev',
      '--name',
      'example',
    ]);
    expect(existsSync(invocation.args[0])).toBe(true);
  });

  it('exits the package script before Prisma when the opt-in is absent', () => {
    const env = { ...process.env };
    delete env.ALLOW_MIGRATE_DEV;
    env.DATABASE_URL = 'postgresql://user:secret-pass@example/db';

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--name', 'must-not-run'],
      { env, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${guard.REFUSAL_MESSAGE}\n`);
    expect(result.stderr).not.toContain('secret-pass');
    expect(result.stderr).not.toContain('Prisma schema');
  });
});
