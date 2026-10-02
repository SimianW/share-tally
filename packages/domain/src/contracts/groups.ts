export type GroupIcon<IconName extends string = string> =
  | { type: "lucide"; value: IconName }
  | { type: "unicode"; value: string };

export type GroupDraft<IconName extends string = string> = { name: string; icon: GroupIcon<IconName> };
export type GroupView<IconName extends string = string> = GroupDraft<IconName> & {
  id: string;
  createdBy: string;
  createdAt: string;
  creatorName: string;
  creatorImageUrl?: string | null;
  creatorFallbackImageUrl?: string | null;
  memberCount: number;
  isCreator: boolean;
  // When the current user joined this group.
  joinedAt: string;
};
export type MemberPreview = { id: string; displayName: string; imageUrl: string | null; fallbackImageUrl: string | null };
// A group in the member's list, ordered by when they joined it. netCents is their
// own balance there, the same number as the group page; it is null only for a
// group joined here whose list entry has not been read back yet.
export type ListedGroup<IconName extends string = string> = GroupView<IconName> & { netCents: number | null; pendingActionCount: number | null; memberPreview: MemberPreview[] };
export type GroupDetail<IconName extends string = string> = GroupView<IconName> & {
  members: { id: string; displayName: string; imageUrl?: string | null; fallbackImageUrl?: string | null; joinedAt: string; isCreator: boolean; isCurrentUser: boolean }[];
};
export type GroupDeletionReason =
  | { code: 'incomplete_bills'; count: number }
  | { code: 'pending_repayments'; count: number }
  | { code: 'nonzero_balances'; members: { userId: string; displayName: string; netCents: number }[] };
export type GroupDeletionEligibility = { eligible: boolean; reasons: GroupDeletionReason[] };

