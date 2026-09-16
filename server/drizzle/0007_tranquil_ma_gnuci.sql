CREATE TABLE "repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "repayments_creation_request" UNIQUE("sender_id","request_id"),
	CONSTRAINT "repayments_distinct_members" CHECK ("repayments"."sender_id" <> "repayments"."recipient_id"),
	CONSTRAINT "repayments_amount_range" CHECK ("repayments"."amount_cents" between 1 and 1000000),
	CONSTRAINT "repayments_state" CHECK (("repayments"."status" = 'pending' and "repayments"."decided_at" is null) or ("repayments"."status" in ('confirmed', 'rejected') and "repayments"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repayments_group_idx" ON "repayments" USING btree ("group_id");