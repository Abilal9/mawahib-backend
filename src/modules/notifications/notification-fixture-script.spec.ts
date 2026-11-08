import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const script = join(__dirname, '../../../scripts/seed-notification-history.mjs');

function runFixture(): Promise<{ code: number | null; stderr: string; stdout: string; elapsedMs: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '11111111-1111-4111-8111-111111111111', '25'], {
      env: {
        ...process.env,
        ENABLE_NOTIFICATION_FIXTURE: 'true',
        DATABASE_URL: 'postgresql://fixture:fixture@192.0.2.1:5432/fixture',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('fixture command did not exit'));
    }, 1500);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout, elapsedMs: Date.now() - started });
    });
  });
}

describe('disabled notification fixture command', () => {
  it('exits before connecting or writing, even when fixture mode and a database url are set', async () => {
    const source = readFileSync(script, 'utf8');
    expect(source).not.toMatch(/PrismaClient|createMany|\$connect/);
    const result = await runFixture();
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/not implemented/i);
    expect(result.stderr).toMatch(/does not connect/i);
    expect(result.stdout).not.toMatch(/Inserted/);
    expect(result.elapsedMs).toBeLessThan(1500);
  });
});
