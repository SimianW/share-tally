CREATE TABLE "receipt_evidence" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"analysis" jsonb NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_evidence" ADD CONSTRAINT "receipt_evidence_draft_id_receipt_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."receipt_drafts"("id") ON DELETE cascade ON UPDATE no action;