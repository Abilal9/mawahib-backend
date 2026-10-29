import { SetMetadata } from '@nestjs/common';

/** Skip JWT entirely. Does not personalize from Authorization. */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
