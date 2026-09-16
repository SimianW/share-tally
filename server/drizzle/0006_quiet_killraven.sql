ALTER TABLE "bill_shares" DROP CONSTRAINT "bill_shares_confirmation";--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_shares" ADD CONSTRAINT "bill_shares_confirmation" CHECK ("bill_shares"."confirmed_at" is null or "bill_shares"."amount_cents" is not null);--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_revision_positive" CHECK ("bills"."revision" > 0);--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_canceled_incomplete" CHECK ("bills"."canceled_at" is null or "bills"."completed_at" is null);