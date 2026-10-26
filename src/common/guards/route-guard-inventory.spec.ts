import { createRequire } from 'module';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from './jwt-auth.guard';

const SRC_ROOT = join(__dirname, '..', '..');
const loadModule = createRequire(__filename);

/**
 * Controllers that are intentionally reachable without a Supabase JWT.
 * Account status is enforced inside JwtStrategy, so a controller that omits
 * JwtAuthGuard also omits suspension.
 */
const PUBLIC_CONTROLLERS = new Set(['HealthController']);

type Constructable = abstract new (...args: never[]) => object;

/** Only `*.controller.ts` files are scanned. A controller in another filename is invisible here. */
function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

function isController(value: unknown): value is Constructable {
  if (typeof value !== 'function') return false;
  return Reflect.getMetadata(PATH_METADATA, value) !== undefined;
}

function routeMethodNames(target: Constructable): string[] {
  const proto = target.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter((name) => {
    if (name === 'constructor') return false;
    const method = proto[name];
    return (
      typeof method === 'function' &&
      Reflect.getMetadata(PATH_METADATA, method) !== undefined
    );
  });
}

function usesJwtGuard(target: object): boolean {
  const guards = Reflect.getMetadata(GUARDS_METADATA, target) as
    unknown[] | undefined;
  return Array.isArray(guards) && guards.includes(JwtAuthGuard);
}

function methodTarget(controller: Constructable, name: string): object {
  return (controller.prototype as Record<string, unknown>)[name] as object;
}

describe('authenticated route inventory', () => {
  const controllers = controllerFiles(SRC_ROOT).flatMap((file) => {
    const exported = loadModule(file) as Record<string, unknown>;
    return Object.values(exported).filter(isController);
  });

  it('discovers the product controllers', () => {
    const names = controllers.map((controller) => controller.name).sort();
    expect(names).toContain('HealthController');
    expect(names).toContain('UsersController');
    expect(names).toContain('AuthController');
    expect(names).toContain('TaxonomyController');
    expect(names).toContain('MediaController');
    expect(names).toContain('PaymentsController');
    expect(names.length).toBeGreaterThan(10);
  });

  it('requires JwtAuthGuard on every controller except health', () => {
    const unguarded = controllers
      .filter((controller) => !PUBLIC_CONTROLLERS.has(controller.name))
      .filter((controller) => {
        if (usesJwtGuard(controller)) return false;
        const methods = routeMethodNames(controller);
        return (
          methods.length === 0 ||
          methods.some((name) => !usesJwtGuard(methodTarget(controller, name)))
        );
      })
      .map((controller) => controller.name);

    expect(unguarded).toEqual([]);
  });

  it('leaves health public', () => {
    const health = controllers.find(
      (controller) => controller.name === 'HealthController',
    );
    expect(health).toBeDefined();
    const controller = health as Constructable;
    expect(usesJwtGuard(controller)).toBe(false);
    for (const name of routeMethodNames(controller)) {
      expect(usesJwtGuard(methodTarget(controller, name))).toBe(false);
    }
  });
});
