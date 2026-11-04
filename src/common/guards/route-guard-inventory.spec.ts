import { createRequire } from 'module';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { PATH_METADATA } from '@nestjs/common/constants';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_BOOTSTRAP_ALLOWED_KEY } from '../decorators/bootstrap-allowed.decorator';
import { PUBLIC_DISCOVERY_RATE_LIMIT_KEY } from '../decorators/public-discovery-rate-limit.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  STAFF_ONLY_KEY,
  STAFF_ROLE_KEY,
} from '../decorators/staff-only.constants';
import { StaffGuard } from '../../modules/staff/staff.guard';

const SRC_ROOT = join(__dirname, '..', '..');
const loadModule = createRequire(__filename);

/** Phase D: Health plus the dedicated Guest/public discovery surface. */
const PUBLIC_ALLOWLIST = new Set([
  'HealthController.getHealth',
  'PublicFeedController.listFeed',
  'PublicFeedController.getPost',
  'PublicProfilesController.getProfile',
  'PublicProfilesController.listPosts',
  'PublicProfilesController.listServices',
  'PublicProfilesController.listPortfolio',
  'PublicProfilesController.listReviews',
  'PublicOfferingsController.getService',
  'PublicOfferingsController.listReviews',
  'PublicJobsController.listJobs',
  'PublicJobsController.getJob',
  'PublicExploreController.listTalents',
  'PublicExploreController.listServices',
  'PublicTaxonomyController.listTaxonomy',
]);

/** Phase C: missing-row admission is only for POST /auth/bootstrap. */
const BOOTSTRAP_ALLOWLIST = new Set(['AuthController.bootstrap']);

type Constructable = abstract new (...args: never[]) => object;

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

function methodTarget(controller: Constructable, name: string): object {
  return (controller.prototype as Record<string, unknown>)[name] as object;
}

function metadataOn(
  key: string,
  controller: Constructable,
  methodName?: string,
): boolean {
  const classMeta = Reflect.getMetadata(key, controller) === true;
  if (!methodName) return classMeta;
  const methodMeta =
    Reflect.getMetadata(key, methodTarget(controller, methodName)) === true;
  return classMeta || methodMeta;
}

function usesRequestUser(source: string): boolean {
  return (
    source.includes('@CurrentUser(') ||
    source.includes('req.user') ||
    source.includes('request.user')
  );
}

/**
 * Optional `viewerId` parameter. A word boundary keeps `reviewerId` from matching.
 * Spaces around `?` and `:` are still the same declaration.
 */
function declaresViewerParameter(source: string): boolean {
  return /\bviewerId\s*\?\s*:/.test(source);
}

describe('authenticated route inventory', () => {
  const controllers = controllerFiles(SRC_ROOT).flatMap((file) => {
    const exported = loadModule(file) as Record<string, unknown>;
    return Object.values(exported).filter(isController);
  });
  const appModule = readFileSync(join(SRC_ROOT, 'app.module.ts'), 'utf8');

  it('discovers the product controllers', () => {
    const names = controllers.map((controller) => controller.name).sort();
    expect(names).toContain('HealthController');
    expect(names).toContain('UsersController');
    expect(names).toContain('AuthController');
    expect(names).toContain('TaxonomyController');
    expect(names).toContain('MediaController');
    expect(names).toContain('PaymentsController');
    expect(names).toContain('SavedController');
    expect(names).toContain('ServiceSavesController');
    expect(names).toContain('PublicFeedController');
    expect(names).toContain('PublicJobsController');
    expect(names.length).toBeGreaterThan(10);
  });

  it('registers JwtAuthGuard as APP_GUARD', () => {
    expect(appModule).toMatch(/provide:\s*APP_GUARD/);
    expect(appModule).toMatch(/useClass:\s*JwtAuthGuard/);
  });

  it('rate-limits exactly the public discovery handlers', () => {
    const limited: string[] = [];
    for (const controller of controllers) {
      for (const name of routeMethodNames(controller)) {
        if (metadataOn(PUBLIC_DISCOVERY_RATE_LIMIT_KEY, controller, name)) {
          limited.push(`${controller.name}.${name}`);
        }
      }
    }
    const discovery = [...PUBLIC_ALLOWLIST].filter(
      (name) => name !== 'HealthController.getHealth',
    );
    expect(limited.sort()).toEqual(discovery.sort());
    expect(appModule).toMatch(/useClass:\s*PublicDiscoveryRateLimitGuard/);
  });

  it('allowlists only Health and Phase D public discovery as @Public', () => {
    const publicRoutes: string[] = [];
    for (const controller of controllers) {
      for (const name of routeMethodNames(controller)) {
        if (metadataOn(IS_PUBLIC_KEY, controller, name)) {
          publicRoutes.push(`${controller.name}.${name}`);
        }
      }
    }
    expect(publicRoutes.sort()).toEqual([...PUBLIC_ALLOWLIST].sort());
  });

  it('allowlists only POST /auth/bootstrap as @BootstrapAllowed', () => {
    const bootstrapRoutes: string[] = [];
    for (const controller of controllers) {
      for (const name of routeMethodNames(controller)) {
        if (metadataOn(IS_BOOTSTRAP_ALLOWED_KEY, controller, name)) {
          bootstrapRoutes.push(`${controller.name}.${name}`);
        }
      }
    }
    expect(bootstrapRoutes).toEqual([...BOOTSTRAP_ALLOWLIST]);
    expect(metadataOn(IS_PUBLIC_KEY, controllers.find((c) => c.name === 'AuthController') as Constructable)).toBe(
      false,
    );
  });

  it('leaves public handlers free of req.user', () => {
    const health = controllers.find(
      (controller) => controller.name === 'HealthController',
    );
    expect(health).toBeDefined();
    expect(metadataOn(IS_PUBLIC_KEY, health as Constructable)).toBe(true);
    const sources = [
      join(SRC_ROOT, 'modules', 'health', 'health.controller.ts'),
      join(SRC_ROOT, 'modules', 'public', 'public.controller.ts'),
      join(SRC_ROOT, 'modules', 'public', 'public.service.ts'),
      join(SRC_ROOT, 'modules', 'public', 'public.repository.ts'),
    ].map((path) => readFileSync(path, 'utf8'));
    for (const source of sources) {
      expect(usesRequestUser(source)).toBe(false);
      expect(declaresViewerParameter(source)).toBe(false);
      expect(source).not.toMatch(/tryAuthenticate/);
    }
  });

  it('detects a viewer parameter without flagging reviewerId', () => {
    expect(declaresViewerParameter('reviewerId?: string')).toBe(false);
    expect(declaresViewerParameter('reviewerId ? : string')).toBe(false);
    expect(declaresViewerParameter('viewerId?: string')).toBe(true);
    expect(declaresViewerParameter('viewerId?:string')).toBe(true);
    expect(declaresViewerParameter('viewerId ?: string')).toBe(true);
    expect(declaresViewerParameter('viewerId? : string')).toBe(true);
    expect(declaresViewerParameter('viewerId ? : string')).toBe(true);
    expect(declaresViewerParameter('function list(viewerId?: string)')).toBe(true);
    expect(declaresViewerParameter('function list(\n  viewerId?: string,\n)')).toBe(
      true,
    );
  });

  it('does not mark bootstrap public', () => {
    const auth = controllers.find((controller) => controller.name === 'AuthController');
    expect(auth).toBeDefined();
    expect(
      metadataOn(IS_PUBLIC_KEY, auth as Constructable, 'bootstrap'),
    ).toBe(false);
  });

  it('does not mark private product controllers public', () => {
    const privateNames = [
      'MessagingController',
      'SavedController',
      'PaymentsController',
      'MediaController',
      'NotificationsController',
    ];
    for (const name of privateNames) {
      const controller = controllers.find((item) => item.name === name);
      expect(controller).toBeDefined();
      expect(metadataOn(IS_PUBLIC_KEY, controller as Constructable)).toBe(false);
      for (const method of routeMethodNames(controller as Constructable)) {
        expect(metadataOn(IS_PUBLIC_KEY, controller as Constructable, method)).toBe(
          false,
        );
      }
    }
  });

  it('keeps staff routes closed and enforced together', () => {
    const staffRoutes: string[] = [];
    for (const controller of controllers) {
      for (const name of routeMethodNames(controller)) {
        const staffOnly = metadataOn(STAFF_ONLY_KEY, controller, name);
        const guards =
          Reflect.getMetadata(
            GUARDS_METADATA,
            methodTarget(controller, name),
          ) ?? [];
        const hasStaffGuard = Array.isArray(guards) && guards.includes(StaffGuard);
        if (staffOnly || hasStaffGuard) {
          staffRoutes.push(`${controller.name}.${name}`);
          expect(staffOnly).toBe(true);
          expect(hasStaffGuard).toBe(true);
          expect(metadataOn(IS_PUBLIC_KEY, controller, name)).toBe(false);
          expect(metadataOn(IS_BOOTSTRAP_ALLOWED_KEY, controller, name)).toBe(
            false,
          );
          expect(
            Reflect.getMetadata(
              STAFF_ROLE_KEY,
              methodTarget(controller, name),
            ) ??
              Reflect.getMetadata(STAFF_ROLE_KEY, controller),
          ).toBe('operator');
        }
      }
    }
    expect(staffRoutes.sort()).toEqual(
      [
        'AdminReadController.dispute',
        'AdminReadController.disputes',
        'AdminReadController.user',
        'AdminReadController.users',
        'StaffSessionController.session',
      ].sort(),
    );
  });
});
