import {
  check,
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
