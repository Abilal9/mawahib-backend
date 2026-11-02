import { SetMetadata } from '@nestjs/common';

/** One shared public-discovery budget. Health and private routes do not set this. */
export const PUBLIC_DISCOVERY_RATE_LIMIT_KEY = 'publicDiscoveryRateLimit';

export const PublicDiscoveryRateLimit = () =>
  SetMetadata(PUBLIC_DISCOVERY_RATE_LIMIT_KEY, true);
