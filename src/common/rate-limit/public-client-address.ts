import { isIP } from 'node:net';
import type { PublicClientAddressMode } from './public-rate-limit.constants';

/**
 * One shared key for every missing or invalid identity.
 * It is still rate-limited. It is not a bypass.
 */
export const FALLBACK_CLIENT_KEY = 'fallback';

export type ClientAddressResolution = {
  key: string;
  identity: 'client' | 'fallback';
};

/**
 * Canonical client key.
 *
 * IPv4 addresses, including IPv4-mapped IPv6, stay one host.
 * Other IPv6 addresses are grouped by the first 64 bits. That keeps a
 * device's temporary addresses on one network in one bucket. A shared
 * /64, such as some mobile networks, also shares one bucket. A client
 * that can use several /64s gets several buckets. Those are the limits
 * of this grouping.
 */
export function normalizeClientAddress(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (/[\s,%/\[\]]/.test(trimmed)) return null;

  if (isIP(trimmed) === 4) return `4:${trimmed}`;
  if (isIP(trimmed) !== 6) return null;

  const groups = expandIpv6(trimmed);
  if (!groups) return null;
  if (isIpv4Mapped(groups)) {
    const a = groups[6] >> 8;
    const b = groups[6] & 0xff;
    const c = groups[7] >> 8;
    const d = groups[7] & 0xff;
    return `4:${a}.${b}.${c}.${d}`;
  }

  const prefix = groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':');
  return `6:${prefix}::/64`;
}

export function resolveClientKey(
  mode: PublicClientAddressMode,
  source: {
    remoteAddress?: string | null;
    realIpHeader?: string | string[] | undefined;
  },
): ClientAddressResolution {
  const raw =
    mode === 'socket' ? source.remoteAddress ?? undefined : singleHeader(source.realIpHeader);
  if (typeof raw !== 'string') {
    return { key: FALLBACK_CLIENT_KEY, identity: 'fallback' };
  }
  const key = normalizeClientAddress(raw);
  if (!key) return { key: FALLBACK_CLIENT_KEY, identity: 'fallback' };
  return { key, identity: 'client' };
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isIpv4Mapped(groups: number[]): boolean {
  return groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
}

function expandIpv6(input: string): number[] | null {
  if (input.includes(':::')) return null;
  const lastColon = input.lastIndexOf(':');
  const tail = lastColon >= 0 ? input.slice(lastColon + 1) : input;
  let body = input;
  let v4Tail: [number, number] | null = null;
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return null;
    const parts = tail.split('.').map((part) => Number(part));
    v4Tail = [(parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]];
    body = input.slice(0, lastColon);
  }

  const double = body.includes('::');
  if (double && body.indexOf('::') !== body.lastIndexOf('::')) return null;
  const halves = double ? body.split('::') : [body];
  const left = halves[0] === '' ? [] : halves[0].split(':');
  const right = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : [];
  const expected = 8 - (v4Tail ? 2 : 0);
  const fill = expected - left.length - right.length;
  if (double) {
    if (fill < 1) return null;
  } else if (left.length !== expected) {
    return null;
  }

  const textGroups = double ? [...left, ...Array.from({ length: fill }, () => '0'), ...right] : left;
  if (textGroups.length !== expected) return null;
  const groups: number[] = [];
  for (const group of textGroups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    groups.push(Number.parseInt(group, 16));
  }
  if (v4Tail) groups.push(v4Tail[0], v4Tail[1]);
  return groups.length === 8 ? groups : null;
}
