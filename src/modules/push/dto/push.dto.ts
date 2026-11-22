import { IsIn, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class RegisterPushDeviceDto {
  @IsUUID()
  installationId!: string;

  @IsString()
  @MaxLength(255)
  @Matches(/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/, {
    message: 'Use the push token from this installation.',
  })
  expoPushToken!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}

export class SetPushViewingDto {
  @IsUUID()
  conversationId!: string;
}
