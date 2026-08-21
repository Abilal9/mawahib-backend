import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { locationDisplayFields } from '../../common/location/geo';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { BootstrapAuthDto, UpdateMeDto } from './dto/user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { USER_REPOSITORY } from './repositories/user.repository';
import type {
  UserRepository,
  UserWithProfile,
} from './repositories/user.repository';

export interface AuthIdentity {
  sub: string;
  email?: string;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function normalizePhone(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return Boolean(left && right && left === right);
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    private readonly supabase: SupabaseService,
  ) {}

  async getMe(identity: AuthIdentity): Promise<UserResponseDto> {
    const user = await this.requireUser(identity.sub);
    return this.syncTrustedVerification(user);
  }

  /** Visitor / discovery profile (same shape as /me, JWT required). */
  async getById(userId: string): Promise<UserResponseDto> {
    const user = await this.requireUser(userId);
    return UserResponseDto.fromEntity(user);
  }

  async bootstrap(
    identity: AuthIdentity,
    dto: BootstrapAuthDto,
  ): Promise<UserResponseDto> {
    const existing = await this.users.findById(identity.sub);
    if (existing) {
      return this.syncBootstrapFields(existing, dto);
    }

    const trusted = await this.supabase.getAuthVerification(identity.sub);
    const email = this.resolveTrustedEmail(identity, trusted, dto.email);

    const byEmail = await this.users.findByEmail(email);
    if (byEmail) {
      throw new ConflictException('A user with this email already exists');
    }

    const phoneE164 = normalizePhone(dto.phoneE164);
    if (!phoneE164) {
      throw new ConflictException(
        'Phone number (E.164) is required to bootstrap a Mawahib user',
      );
    }
    const byPhone = await this.users.findByPhoneE164(phoneE164);
    if (byPhone) {
      throw new ConflictException(
        'A user with this phone number already exists',
      );
    }

    const username = await this.resolveUsername(
      dto.username,
      dto.displayName,
      email,
    );

    const location = this.resolveOptionalLocation(dto);
    const phoneVerified = this.boundPhoneVerified(trusted, phoneE164);

    const created = await this.users.createWithProfile({
      id: identity.sub,
      email,
      accountType: dto.accountType,
      displayName: dto.displayName.trim(),
      username,
      countryCode: location?.countryCode ?? null,
      locationCode: location?.locationCode ?? null,
      locationCity: location?.locationCity ?? dto.locationCity?.trim() ?? null,
      locationCountry: location?.locationCountry ?? null,
      phoneE164,
      phoneVerified,
      emailVerified: trusted.trusted ? trusted.emailVerified : false,
    });

    return UserResponseDto.fromEntity(created);
  }

  async updateMe(
    identity: AuthIdentity,
    dto: UpdateMeDto,
  ): Promise<UserResponseDto> {
    const existing = await this.requireUser(identity.sub);

    if (dto.username) {
      const taken = await this.users.findByUsername(dto.username);
      if (taken && taken.id !== identity.sub) {
        throw new ConflictException('Username is already taken');
      }
    }

    if (dto.phoneE164) {
      const byPhone = await this.users.findByPhoneE164(dto.phoneE164);
      if (byPhone && byPhone.id !== identity.sub) {
        throw new ConflictException(
          'A user with this phone number already exists',
        );
      }
    }

    const locationPatch =
      dto.countryCode !== undefined
        ? this.requireLocationPair(dto.countryCode, dto.locationCode)
        : null;

    const nextPhone =
      dto.phoneE164 !== undefined
        ? normalizePhone(dto.phoneE164)
        : undefined;
    const phoneChanged =
      nextPhone !== undefined &&
      !phonesMatch(nextPhone, existing.profile?.phoneE164);

    // Client must never set emailVerified / phoneVerified via DTO.
    const updated = await this.users.updateOwn(identity.sub, {
      displayName: dto.displayName?.trim(),
      username: dto.username?.trim().toLowerCase(),
      title: dto.title,
      bio: dto.bio,
      ...(locationPatch
        ? {
            countryCode: locationPatch.countryCode,
            locationCode: locationPatch.locationCode,
            locationCity: locationPatch.locationCity,
            locationCountry: locationPatch.locationCountry,
          }
        : {
            locationCity: dto.locationCity,
            locationCountry: dto.locationCountry,
          }),
      avatarUrl: dto.avatarUrl,
      coverUrl: dto.coverUrl,
      skills: dto.skills?.map((s) => s.trim()).filter(Boolean),
      phoneE164: dto.phoneE164,
      // Changing the stored number clears Nest verification until rebound to Auth.
      ...(phoneChanged ? { phoneVerified: false } : {}),
    });

    return this.syncTrustedVerification(updated);
  }

  /**
   * Idempotent bootstrap: fill missing phone / location; verification always
   * comes from Supabase Auth, never from the client DTO.
   */
  private async syncBootstrapFields(
    existing: UserWithProfile,
    dto: BootstrapAuthDto,
  ): Promise<UserResponseDto> {
    const patch: {
      phoneE164?: string | null;
      phoneVerified?: boolean;
      countryCode?: string | null;
      locationCode?: string | null;
      locationCity?: string | null;
      locationCountry?: string | null;
    } = {};

    const phoneE164 = normalizePhone(dto.phoneE164);
    if (phoneE164 && !existing.profile?.phoneE164) {
      const byPhone = await this.users.findByPhoneE164(phoneE164);
      if (byPhone && byPhone.id !== existing.id) {
        throw new ConflictException(
          'A user with this phone number already exists',
        );
      }
      patch.phoneE164 = phoneE164;
      // New stored phone starts unverified; syncTrustedVerification may promote
      // only if it exactly matches Auth's confirmed phone.
      patch.phoneVerified = false;
    }

    if (!existing.profile?.countryCode) {
      const location = this.resolveOptionalLocation(dto);
      if (location) {
        patch.countryCode = location.countryCode;
        patch.locationCode = location.locationCode;
        patch.locationCity = location.locationCity;
        patch.locationCountry = location.locationCountry;
      }
    }

    const base =
      Object.keys(patch).length === 0
        ? existing
        : await this.users.updateOwn(existing.id, patch);

    return this.syncTrustedVerification(base);
  }

  /**
   * Align Nest verification flags with Supabase Auth.
   * phoneVerified is true only when Auth says confirmed AND phones match exactly.
   */
  private async syncTrustedVerification(
    user: UserWithProfile,
  ): Promise<UserResponseDto> {
    const trusted = await this.supabase.getAuthVerification(user.id);
    if (!trusted.trusted) {
      return UserResponseDto.fromEntity(user);
    }

    const emailVerified = trusted.emailVerified;
    const phoneVerified = this.boundPhoneVerified(
      trusted,
      user.profile?.phoneE164,
    );

    const emailMismatch =
      emailVerified !== Boolean(user.profile?.emailVerified);
    const phoneMismatch =
      phoneVerified !== Boolean(user.profile?.phoneVerified);

    if (!emailMismatch && !phoneMismatch) {
      return UserResponseDto.fromEntity(user);
    }

    this.logger.debug(
      `Syncing verification for ${user.id}: email=${emailVerified} phone=${phoneVerified}`,
    );

    const updated = await this.users.updateOwn(user.id, {
      emailVerified,
      phoneVerified,
    });
    return UserResponseDto.fromEntity(updated);
  }

  /**
   * Canonical Nest email must match authenticated identity (JWT and/or Auth admin).
   * Client dto.email cannot redefine identity; mismatch → 400.
   */
  private resolveTrustedEmail(
    identity: AuthIdentity,
    trusted: { email: string | null; trusted: boolean },
    dtoEmail?: string,
  ): string {
    const jwtEmail = normalizeEmail(identity.email);
    const authEmail = trusted.trusted ? normalizeEmail(trusted.email) : null;
    const canonical = authEmail ?? jwtEmail;
    if (!canonical) {
      throw new ConflictException(
        'Email is required to bootstrap a Mawahib user',
      );
    }

    const clientEmail = normalizeEmail(dtoEmail);
    if (clientEmail && clientEmail !== canonical) {
      throw new BadRequestException(
        'Email must match the authenticated Supabase identity',
      );
    }

    return canonical;
  }

  /** Auth phoneVerified applies only when Nest phone equals Auth phone. */
  private boundPhoneVerified(
    trusted: {
      trusted: boolean;
      phoneVerified: boolean;
      phone: string | null;
    },
    nestPhone: string | null | undefined,
  ): boolean {
    if (!trusted.trusted || !trusted.phoneVerified) return false;
    return phonesMatch(trusted.phone, nestPhone);
  }

  private resolveOptionalLocation(dto: {
    countryCode?: string | null;
    locationCode?: string | null;
  }): ReturnType<typeof locationDisplayFields> | null {
    if (!dto.countryCode && !dto.locationCode) return null;
    return this.requireLocationPair(dto.countryCode, dto.locationCode);
  }

  private requireLocationPair(
    countryCode: string | null | undefined,
    locationCode: string | null | undefined,
  ): ReturnType<typeof locationDisplayFields> {
    if (!countryCode || !locationCode) {
      throw new BadRequestException(
        'countryCode and locationCode must be provided together',
      );
    }
    return locationDisplayFields(countryCode as 'SA' | 'AE', locationCode);
  }

  private async requireUser(id: string): Promise<UserWithProfile> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(
        'User profile not found. Call POST /auth/bootstrap first.',
      );
    }
    return user;
  }

  private async resolveUsername(
    requested: string | undefined,
    displayName: string,
    email: string,
  ): Promise<string> {
    const base = this.slugify(
      requested || displayName || email.split('@')[0] || 'user',
    );
    let candidate = base;
    let i = 0;
    while (await this.users.findByUsername(candidate)) {
      i += 1;
      candidate = `${base}${i}`;
      if (i > 50) {
        candidate = `${base}${Date.now().toString(36)}`;
        break;
      }
    }
    return candidate;
  }

  private slugify(value: string): string {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
    return slug.length >= 3 ? slug : `user_${slug || 'x'}`;
  }
}

export type { AccountType };
