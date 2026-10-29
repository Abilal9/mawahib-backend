import { SetMetadata } from '@nestjs/common';

/**
 * JWT is still required and validated.
 * A missing Mawahib user row is allowed so bootstrap can create it.
 * Does not skip recovery, suspension, deletion, or malformed tokens.
 */
export const IS_BOOTSTRAP_ALLOWED_KEY = 'bootstrapAllowed';

export const BootstrapAllowed = () => SetMetadata(IS_BOOTSTRAP_ALLOWED_KEY, true);
