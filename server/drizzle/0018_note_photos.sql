CREATE TABLE "note_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid,
	"bill_id" uuid,
	"position" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_photos_draft_position" UNIQUE("draft_id","position"),
	CONSTRAINT "note_photos_bill_position" UNIQUE("bill_id","position"),
	CONSTRAINT "note_photos_owner" CHECK (num_nonnulls("note_photos"."draft_id", "note_photos"."bill_id") = 1),
	CONSTRAINT "note_photos_position" CHECK ("note_photos"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "note_photos" ADD CONSTRAINT "note_photos_draft_id_receipt_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."receipt_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_photos" ADD CONSTRAINT "note_photos_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;