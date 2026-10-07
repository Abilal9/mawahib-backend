import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Create a payment for an engagement.
 *
 * Deliberately has NO amount, currency, PAN, CVV or expiry fields: the amount
 * is always the engagement's chargeable total, and the global ValidationPipe
 * (`forbidNonWhitelisted`) rejects any extra field a client sends.
 */
export class CreatePaymentDto {
  @IsUUID()
  engagementId!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /** Dev mock token, e.g. `mock_visa_success`. Never raw card data. */
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'mockMethodToken must be a lowercase token, not card data',
  })
  mockMethodToken!: string;

  /** Client-generated key; retries with the same key return the same payment. */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_\-:.]+$/)
  idempotencyKey!: string;
}
