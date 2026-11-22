import { SetMetadata } from '@nestjs/common';

/** Skip the account JWT. The handler must require the registration detach secret. */
export const IS_REGISTRATION_CREDENTIAL_KEY = 'isRegistrationCredential';

export const RegistrationCredential = () =>
  SetMetadata(IS_REGISTRATION_CREDENTIAL_KEY, true);
