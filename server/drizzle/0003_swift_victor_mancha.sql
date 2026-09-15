ALTER TABLE "groups" ADD COLUMN "invitation_token" text;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_invitation_token_unique" UNIQUE("invitation_token");