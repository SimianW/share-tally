ALTER TABLE "bill_items" ADD COLUMN "taxable" boolean;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "manual_final" boolean;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "allocated_discount_cents" integer;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "frozen_tax_rounding_cents" integer;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "frozen_discount_rounding_cents" integer;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "frozen_extra_rounding_cents" integer;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "receipt" jsonb;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "frozen_tax_base_cents" integer;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "frozen_discount_base_cents" integer;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "frozen_extra_base_cents" integer;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "frozen_discount_weight_cents" integer;--> statement-breakpoint
ALTER TABLE "bill_items" ADD COLUMN "frozen_net_weight_cents" integer;--> statement-breakpoint
ALTER TABLE "bill_items" ALTER COLUMN "tax_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_items" ALTER COLUMN "extra_cents" DROP NOT NULL;