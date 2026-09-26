ALTER TABLE "receipt_drafts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Creation time was not recorded for existing drafts; use their last edit as the closest available timestamp.
UPDATE "receipt_drafts" SET "created_at" = "updated_at";
