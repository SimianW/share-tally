import {
  check,
  boolean,
  jsonb,
  date,
  integer,
  unique,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql/sql';

export const users = pgTable('users', {
  // defualtRandom() is a function that generates a random UUID for the primary key
  // primaryKey() is a function that sets the primary key for the table
  id: uuid('id').primaryKey().defaultRandom(),

  // clerkUserId is a unique identifier for the user in Clerk
  // notNull() is a function that sets the column to be NOT NULL
  clerkUserId: text('clerk_user_id').notNull().unique(),

  // Cached from the verified Clerk profile when the user first opens groups.
  displayName: text('display_name'),

  // createdAt is a timestamp for when the user was created
  // notNull() is a function that sets the column to be NOT NULL
  // defaultNow() is a function that sets the default value to the current timestamp
  createdAt: timestamp('created_at', {
    withTimezone: true
  }).notNull().defaultNow(),
});

export type AppUser = typeof users.$inferSelect;

type StoreGroupIcon =
  | `lucide:${string}`
  | `unicode:${string}`;

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),

  name: text('name').notNull(),

  // Null only until a creator first retrieves the invitation.
  invitationToken: text('invitation_token').unique(),

  icon: text('icon')
    .$type<StoreGroupIcon>()
    .notNull()
    .default('lucide:shopping-basket'),

  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),  // for lazy evaluation of the users table

  createdAt: timestamp('created_at', {
    withTimezone: true
  })
    .notNull()
    .defaultNow(),
},
  // Require 1–40 characters after trimming surrounding spaces.
  (table) => [
    check(
      'groups_name_length',
      sql`char_length(btrim(${table.name})) between 1 and 40`,
    ),

    check(
      'groups_icon_allowed',
      sql`${table.icon} ~ '^(lucide:[a-z0-9]+(-[a-z0-9]+)*|unicode:.+)$'`,
    )
  ],
);

export const groupMembers = pgTable(
  'group_members', {
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id),

  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),

  joinedAt: timestamp('joined_at', {
    withTimezone: true
  })
    .notNull()
    .defaultNow(),
},
  (table) => [
    primaryKey({
      columns: [table.groupId, table.userId],
    }),
    index('group_members_user_id_idx').on(table.userId),
  ],
);

export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => groups.id),
  initiatorId: uuid('initiator_id').notNull().references(() => users.id),
  requestId: uuid('request_id').notNull(),
  requestPayload: text('request_payload').notNull(),
  mode: text('mode').$type<'manual' | 'items'>().notNull().default('manual'),
  title: text('title').notNull(),
  purchaseDate: date('purchase_date').notNull(),
  notes: text('notes').notNull().default(''),
  totalCents: integer('total_cents').notNull(),
  receipt: jsonb('receipt').$type<{ subtotalCents: number | null; discountCents: number; taxCents: number; extraCents: number; totalCents: number; pricesIncludeTax: boolean }>(),
  frozenTaxBaseCents: integer('frozen_tax_base_cents'),
  frozenDiscountBaseCents: integer('frozen_discount_base_cents'),
  frozenExtraBaseCents: integer('frozen_extra_base_cents'),
  adjustmentCents: integer('adjustment_cents'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check('bills_mode', sql`${table.mode} in ('manual', 'items')`),
  check('bills_revision_positive', sql`${table.revision} > 0`),
  check('bills_canceled_incomplete', sql`${table.canceledAt} is null or ${table.completedAt} is null`),
  unique('bills_creation_request').on(table.initiatorId, table.requestId),
  index('bills_group_idx').on(table.groupId),
  check('bills_total_range', sql`${table.totalCents} between 1 and 1000000`),
  check('bills_title_length', sql`char_length(btrim(${table.title})) between 1 and 120`),
  check('bills_notes_length', sql`char_length(${table.notes}) <= 2000`),
  check('bills_completion', sql`(${table.completedAt} is null and ${table.adjustmentCents} is null) or (${table.completedAt} is not null and ${table.adjustmentCents} is not null and (${table.mode} = 'items' or ${table.adjustmentCents} between -5 and 5))`),
]);

export const billShares = pgTable('bill_shares', {
  billId: uuid('bill_id').notNull().references(() => bills.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  amountCents: integer('amount_cents'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, table => [
  primaryKey({ columns: [table.billId, table.userId] }),
  check('bill_shares_amount', sql`${table.amountCents} between 0 and 1000000`),
  check('bill_shares_confirmation', sql`${table.confirmedAt} is null or ${table.amountCents} is not null`),
]);

export const repayments = pgTable('repayments', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => groups.id),
  senderId: uuid('sender_id').notNull().references(() => users.id),
  recipientId: uuid('recipient_id').notNull().references(() => users.id),
  requestId: uuid('request_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  status: text('status').$type<'pending' | 'confirmed' | 'rejected'>().notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, table => [
  unique('repayments_creation_request').on(table.senderId, table.requestId),
  index('repayments_group_idx').on(table.groupId),
  check('repayments_distinct_members', sql`${table.senderId} <> ${table.recipientId}`),
  check('repayments_amount_range', sql`${table.amountCents} between 1 and 1000000`),
  check('repayments_state', sql`(${table.status} = 'pending' and ${table.decidedAt} is null) or (${table.status} in ('confirmed', 'rejected') and ${table.decidedAt} is not null)`),
]);


export const receiptDrafts = pgTable('receipt_drafts', {
  id: uuid('id').primaryKey(),
  groupId: uuid('group_id').notNull().references(() => groups.id),
  initiatorId: uuid('initiator_id').notNull().references(() => users.id),
  data: jsonb('data').$type<import('../receipt-input.js').ReceiptDraftData>().notNull(),
  revision: integer('revision').notNull().default(1),
  billId: uuid('bill_id').references(() => bills.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('receipt_drafts_owner_idx').on(table.initiatorId, table.groupId)]);

export const receiptPhotos = pgTable('receipt_photos', {
  draftId: uuid('draft_id').primaryKey().references(() => receiptDrafts.id, { onDelete: 'cascade' }),
  base64: text('base64').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const billItems = pgTable('bill_items', {
  id: uuid('id').primaryKey(),
  billId: uuid('bill_id').notNull().references(() => bills.id),
  position: integer('position').notNull(),
  name: text('name').notNull(), originalText: text('original_text').notNull(),
  quantity: text('quantity').notNull(),
  amountCents: integer('amount_cents').notNull(), taxCents: integer('tax_cents').notNull(),
  discountCents: integer('discount_cents').notNull(), extraCents: integer('extra_cents').notNull(),
  finalCents: integer('final_cents').notNull(),
  taxable: boolean('taxable'),
  manualFinal: boolean('manual_final'),
  allocatedDiscountCents: integer('allocated_discount_cents'),
  frozenTaxRoundingCents: integer('frozen_tax_rounding_cents'),
  frozenDiscountRoundingCents: integer('frozen_discount_rounding_cents'),
  frozenExtraRoundingCents: integer('frozen_extra_rounding_cents'),
}, table => [index('bill_items_bill_idx').on(table.billId), check('bill_items_cost', sql`${table.finalCents} between 0 and 1000000`)]);

export const itemClaims = pgTable('item_claims', {
  itemId: uuid('item_id').notNull().references(() => billItems.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  numerator: integer('numerator').notNull(), denominator: integer('denominator').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, table => [primaryKey({ columns: [table.itemId, table.userId] }),
  check('item_claims_fraction', sql`${table.numerator} between 1 and ${table.denominator} and ${table.denominator} between 1 and 10000`)]);
