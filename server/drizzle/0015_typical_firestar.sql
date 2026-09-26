ALTER TABLE "receipt_drafts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Creation time was not recorded for existing drafts; use their last edit as the closest available timestamp.
-- This friend-group trial has only a handful of receipt drafts at deployment,
-- so updating these rows in one migration is preferable to a batched backfill.
UPDATE "receipt_drafts" SET "created_at" = "updated_at";
