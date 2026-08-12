import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';
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

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
  ) {}

  async getMe(identity: AuthIdentity): Promise<UserResponseDto> {
    const user = await this.requireUser(identity.sub);
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

    const email = (dto.email ?? identity.email)?.trim().toLowerCase();
    if (!email) {
      throw new ConflictException(
        'Email is required to bootstrap a Mawahib user',
      );
    }

    const byEmail = await this.users.findByEmail(email);
    if (byEmail) {
      throw new ConflictException('A user with this email already exists');
    }

    const phoneE164 = dto.phoneE164?.trim();
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

    const created = await this.users.createWithProfile({
      id: identity.sub,
      email,
      accountType: dto.accountType,
      displayName: dto.displayName.trim(),
      username,
      locationCity: dto.locationCity?.trim() || null,
      phoneE164,
      phoneVerified: dto.phoneVerified ?? false,
      emailVerified: dto.emailVerified ?? false,
    });

    return UserResponseDto.fromEntity(created);
  }

  async updateMe(
    identity: AuthIdentity,
    dto: UpdateMeDto,
  ): Promise<UserResponseDto> {
    await this.requireUser(identity.sub);

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

    const updated = await this.users.updateOwn(identity.sub, {
      displayName: dto.displayName?.trim(),
      username: dto.username?.trim().toLowerCase(),
      title: dto.title,
      bio: dto.bio,
      locationCity: dto.locationCity,
      locationCountry: dto.locationCountry,
      avatarUrl: dto.avatarUrl,
      coverUrl: dto.coverUrl,
      skills: dto.skills?.map((s) => s.trim()).filter(Boolean),
      phoneE164: dto.phoneE164,
      phoneVerified: dto.phoneVerified,
      emailVerified: dto.emailVerified,
    });

    return UserResponseDto.fromEntity(updated);
  }

  /**
   * Idempotent bootstrap: fill missing phone / bump verification flags without
   * creating a second account.
   */
  private async syncBootstrapFields(
    existing: UserWithProfile,
    dto: BootstrapAuthDto,
  ): Promise<UserResponseDto> {
    const patch: {
      phoneE164?: string | null;
      phoneVerified?: boolean;
      emailVerified?: boolean;
    } = {};

    const phoneE164 = dto.phoneE164?.trim();
    if (phoneE164 && !existing.profile?.phoneE164) {
      const byPhone = await this.users.findByPhoneE164(phoneE164);
      if (byPhone && byPhone.id !== existing.id) {
        throw new ConflictException(
          'A user with this phone number already exists',
        );
      }
      patch.phoneE164 = phoneE164;
    }
    if (dto.phoneVerified === true && !existing.profile?.phoneVerified) {
      patch.phoneVerified = true;
    }
    if (dto.emailVerified === true && !existing.profile?.emailVerified) {
      patch.emailVerified = true;
    }

    if (Object.keys(patch).length === 0) {
      return UserResponseDto.fromEntity(existing);
    }

    const updated = await this.users.updateOwn(existing.id, patch);
    return UserResponseDto.fromEntity(updated);
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
