CREATE TABLE "trust_event" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"cycle_id" text,
	"kind" text NOT NULL,
	"score" integer NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"ref_id" text,
	"note" text,
	"voided" boolean DEFAULT false NOT NULL,
	"voided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trust_event_subject" ON "trust_event" USING btree ("subject_type","subject_id");