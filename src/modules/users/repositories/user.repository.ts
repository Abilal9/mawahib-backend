import {
  AccountType,
  Prisma,
  User as PrismaUser,
  Profile as PrismaProfile,
  UserSkill,
} from '@prisma/client';

export { AccountType };

export type UserWithProfile = PrismaUser & {
  profile: PrismaProfile | null;
  skills: UserSkill[];
};

export interface CreateUserInput {
  id: string;
  email: string;
  accountType: AccountType;
  displayName: string;
  username: string;
  locationCity?: string | null;
  title?: string | null;
  bio?: string;
}

export interface UpdateUserInput {
  displayName?: string;
  username?: string;
  title?: string | null;
  bio?: string;
  locationCity?: string | null;
  locationCountry?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  skills?: string[];
}

export interface UserRepository {
  findById(id: string): Promise<UserWithProfile | null>;
  findByEmail(email: string): Promise<UserWithProfile | null>;
  findByUsername(username: string): Promise<UserWithProfile | null>;
  createWithProfile(input: CreateUserInput): Promise<UserWithProfile>;
  updateOwn(id: string, input: UpdateUserInput): Promise<UserWithProfile>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export type UserCreateData = Prisma.UserCreateInput;
