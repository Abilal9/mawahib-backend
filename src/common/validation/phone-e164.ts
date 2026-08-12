import { ValidateBy, type ValidationOptions } from 'class-validator';

/** Generic E.164: + then 8–15 digits total after +. */
const E164 = /^\+[1-9]\d{7,14}$/;

/** Saudi mobile: +966 + 5 + 8 digits → +9665XXXXXXXX */
const SA_MOBILE_E164 = /^\+9665\d{8}$/;

/**
 * Second-layer phone validation.
 * Saudi (+966) numbers must be mobile format +9665XXXXXXXX.
 * Other countries: standard E.164 shape (length/country rules still UX-side).
 */
export function isValidPhoneE164(value: string): boolean {
  const trimmed = value.trim();
  if (!E164.test(trimmed)) return false;
  if (trimmed.startsWith('+966')) {
    return SA_MOBILE_E164.test(trimmed);
  }
  return true;
}

export function IsPhoneE164(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isPhoneE164',
      validator: {
        validate: (value: unknown) =>
          value == null ||
          value === '' ||
          (typeof value === 'string' && isValidPhoneE164(value)),
        defaultMessage: () =>
          'phoneE164 must be valid E.164 (Saudi mobiles: +9665XXXXXXXX)',
      },
    },
    validationOptions,
  );
}
