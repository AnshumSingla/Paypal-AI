CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"agent" text NOT NULL,
	"input_ref" text NOT NULL,
	"output" jsonb NOT NULL,
	"model" text NOT NULL,
	"accepted" boolean,
	"accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"household_id" text,
	"society_id" text,
	"is_persona" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "basket" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"household_id" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"ceiling_cents" integer DEFAULT 0 NOT NULL,
	"captured_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"authorized_at" timestamp with time zone,
	"received_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "basket_line" (
	"id" text PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"pool_id" text NOT NULL,
	"qty" integer NOT NULL,
	"ceiling_unit_cents" integer NOT NULL,
	"final_unit_cents" integer,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"moq" integer NOT NULL,
	"max_capacity" integer NOT NULL,
	"tiers" jsonb NOT NULL,
	"delivery_window" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"commission_bps" integer,
	"ai_score" integer,
	"ai_rationale" text,
	"ai_flags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle" (
	"id" text PRIMARY KEY NOT NULL,
	"society_id" text NOT NULL,
	"week_label" text NOT NULL,
	"phase" text DEFAULT 'COLLECT' NOT NULL,
	"deadlines" jsonb NOT NULL,
	"commit_opened_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"handover_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" text PRIMARY KEY NOT NULL,
	"society_id" text NOT NULL,
	"unit_label" text NOT NULL,
	"opt_in_nudges" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue" (
	"id" text PRIMARY KEY NOT NULL,
	"basket_line_id" text NOT NULL,
	"type" text NOT NULL,
	"qty_affected" integer NOT NULL,
	"description" text NOT NULL,
	"photo_data_url" text,
	"ai_assessment" jsonb,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"refund_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text,
	"txn_id" text NOT NULL,
	"account" text NOT NULL,
	"seller_id" text,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"memo" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "need" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"household_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"product_id" text,
	"qty" integer NOT NULL,
	"brand_flexible" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"clarification" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"basket_id" text NOT NULL,
	"mode" text NOT NULL,
	"method" text NOT NULL,
	"paypal_order_id" text NOT NULL,
	"paypal_authorization_id" text,
	"paypal_capture_id" text,
	"authorized_cents" integer NOT NULL,
	"captured_cents" integer DEFAULT 0 NOT NULL,
	"paypal_fee_cents" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"honor_expires_at" timestamp with time zone,
	"auth_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"gross_cents" integer NOT NULL,
	"commission_cents" integer NOT NULL,
	"refunds_cents" integer NOT NULL,
	"carried_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer NOT NULL,
	"sender_item_id" text NOT NULL,
	"paypal_batch_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"product_id" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"demand_estimate" integer DEFAULT 0 NOT NULL,
	"winning_bid_id" text,
	"final_unit_cents" integer,
	"kept_qty" integer,
	"ai_notes" text
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"brand" text,
	"pack_size" text NOT NULL,
	"category" text NOT NULL,
	"retail_ref_cents" integer NOT NULL,
	"retail_source" text DEFAULT 'seed' NOT NULL,
	"channel3_id" text,
	"image_url" text,
	"perishable" boolean DEFAULT false NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL,
	"search_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text,
	"payment_id" text NOT NULL,
	"paypal_refund_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"charged_to" text NOT NULL,
	"seller_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"business_name" text NOT NULL,
	"payout_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"license_ref" text,
	"rating_x10" integer DEFAULT 45 NOT NULL,
	"fill_rate_pct" integer DEFAULT 95 NOT NULL,
	"strikes" integer DEFAULT 0 NOT NULL,
	"plan" text DEFAULT 'starter' NOT NULL,
	"paypal_subscription_id" text,
	"subscription_status" text,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "society" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"drop_point" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"auto_select_bids" boolean DEFAULT true NOT NULL,
	"max_qty_per_line" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"paypal_event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_society_id_society_id_fk" FOREIGN KEY ("society_id") REFERENCES "public"."society"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basket" ADD CONSTRAINT "basket_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basket" ADD CONSTRAINT "basket_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basket_line" ADD CONSTRAINT "basket_line_basket_id_basket_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."basket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basket_line" ADD CONSTRAINT "basket_line_pool_id_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pool"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid" ADD CONSTRAINT "bid_pool_id_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pool"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid" ADD CONSTRAINT "bid_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_society_id_society_id_fk" FOREIGN KEY ("society_id") REFERENCES "public"."society"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_society_id_society_id_fk" FOREIGN KEY ("society_id") REFERENCES "public"."society"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_basket_line_id_basket_line_id_fk" FOREIGN KEY ("basket_line_id") REFERENCES "public"."basket_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "need" ADD CONSTRAINT "need_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "need" ADD CONSTRAINT "need_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "need" ADD CONSTRAINT "need_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_basket_id_basket_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."basket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool" ADD CONSTRAINT "pool_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool" ADD CONSTRAINT "pool_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller" ADD CONSTRAINT "seller_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "basket_cycle_household" ON "basket" USING btree ("cycle_id","household_id");--> statement-breakpoint
CREATE INDEX "basket_line_pool" ON "basket_line" USING btree ("pool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_sender_item" ON "payout" USING btree ("sender_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_cycle_product" ON "pool" USING btree ("cycle_id","product_id");