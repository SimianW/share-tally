CREATE TABLE "bill_shares" (
	"bill_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" integer,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "bill_shares_bill_id_user_id_pk" PRIMARY KEY("bill_id","user_id"),
	CONSTRAINT "bill_shares_amount" CHECK ("bill_shares"."amount_cents" between 0 and 1000000),
	CONSTRAINT "bill_shares_confirmation" CHECK (("bill_shares"."amount_cents" is null) = ("bill_shares"."confirmed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"initiator_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_payload" text NOT NULL,
	"title" text NOT NULL,
	"purchase_date" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"total_cents" integer NOT NULL,
	"adjustment_cents" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_creation_request" UNIQUE("initiator_id","request_id"),
	CONSTRAINT "bills_total_range" CHECK ("bills"."total_cents" between 1 and 1000000),
	CONSTRAINT "bills_title_length" CHECK (char_length(btrim("bills"."title")) between 1 and 120),
	CONSTRAINT "bills_notes_length" CHECK (char_length("bills"."notes") <= 2000),
	CONSTRAINT "bills_completion" CHECK (("bills"."completed_at" is null and "bills"."adjustment_cents" is null) or ("bills"."completed_at" is not null and "bills"."adjustment_cents" between -5 and 5))
);
--> statement-breakpoint
ALTER TABLE "bill_shares" ADD CONSTRAINT "bill_shares_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_shares" ADD CONSTRAINT "bill_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bills_group_idx" ON "bills" USING btree ("group_id");