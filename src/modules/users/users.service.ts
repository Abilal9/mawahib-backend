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
      return UserResponseDto.fromEntity(existing);
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
    });

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
