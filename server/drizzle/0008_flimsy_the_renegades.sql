CREATE TABLE "bill_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bill_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"original_text" text NOT NULL,
	"quantity" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"extra_cents" integer NOT NULL,
	"final_cents" integer NOT NULL,
	CONSTRAINT "bill_items_cost" CHECK ("bill_items"."final_cents" between 0 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "item_claims" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"numerator" integer NOT NULL,
	"denominator" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "item_claims_item_id_user_id_pk" PRIMARY KEY("item_id","user_id"),
	CONSTRAINT "item_claims_fraction" CHECK ("item_claims"."numerator" between 1 and "item_claims"."denominator" and "item_claims"."denominator" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "receipt_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"initiator_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"bill_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_photos" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"base64" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bills" DROP CONSTRAINT "bills_completion";--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_claims" ADD CONSTRAINT "item_claims_item_id_bill_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bill_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_claims" ADD CONSTRAINT "item_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_drafts" ADD CONSTRAINT "receipt_drafts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_drafts" ADD CONSTRAINT "receipt_drafts_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_drafts" ADD CONSTRAINT "receipt_drafts_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_photos" ADD CONSTRAINT "receipt_photos_draft_id_receipt_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."receipt_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_items_bill_idx" ON "bill_items" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "receipt_drafts_owner_idx" ON "receipt_drafts" USING btree ("initiator_id","group_id");--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_mode" CHECK ("bills"."mode" in ('manual', 'items'));--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_completion" CHECK (("bills"."completed_at" is null and "bills"."adjustment_cents" is null) or ("bills"."completed_at" is not null and "bills"."adjustment_cents" is not null and ("bills"."mode" = 'items' or "bills"."adjustment_cents" between -5 and 5)));