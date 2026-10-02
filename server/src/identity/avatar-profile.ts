import type { AvatarImages } from './avatars.js';

export function profileAvatars(user: {
  externalAccounts: { provider: string; imageUrl?: string }[];
  hasImage: boolean;
  imageUrl: string;
}): AvatarImages {
  const googleImage = user.externalAccounts.find(account => account.provider === 'google')?.imageUrl;
  const clerkImage = user.hasImage ? user.imageUrl : null;
  return {
    imageUrl: googleImage || clerkImage,
    fallbackImageUrl: googleImage && googleImage !== clerkImage ? clerkImage : null,
  };
}
