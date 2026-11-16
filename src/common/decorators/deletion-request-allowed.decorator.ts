import { SetMetadata } from '@nestjs/common';

/** A suspended product account may call this route. Deletion and recovery stay blocked. */
export const DELETION_REQUEST_ALLOWED_KEY = 'deletionRequestAllowed';

export const DeletionRequestAllowed = () =>
  SetMetadata(DELETION_REQUEST_ALLOWED_KEY, true);
