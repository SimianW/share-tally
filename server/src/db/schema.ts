import {
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  // defualtRandom() is a function that generates a random UUID for the primary key
  // primaryKey() is a function that sets the primary key for the table
  id: uuid('id').primaryKey().defaultRandom(),

  // clerkUserId is a unique identifier for the user in Clerk
  // notNull() is a function that sets the column to be NOT NULL
  clerkUserId: text('clerk_user_id').notNull().unique(),

  // createdAt is a timestamp for when the user was created
  // notNull() is a function that sets the column to be NOT NULL
  // defaultNow() is a function that sets the default value to the current timestamp
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AppUser = typeof users.$inferSelect