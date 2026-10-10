-- Every existing group's owner starts as its creator.
ALTER TABLE "groups" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
UPDATE "groups" SET "owner_id" = "created_by";--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
