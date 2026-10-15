CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`category_id` text,
	`period` text DEFAULT 'monthly' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`rollover` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budgets_category_idx` ON `budgets` (`category_id`);--> statement-breakpoint
CREATE TABLE `category_prefs` (
	`category_id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`display_name` text,
	`hidden` integer DEFAULT false NOT NULL,
	`sort_order` integer,
	`is_custom` integer DEFAULT false NOT NULL,
	`color_key` text
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`at` text NOT NULL,
	`causation_id` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_id_idx` ON `events` (`id`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`,`seq`);--> statement-breakpoint
CREATE TABLE `inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`source` text NOT NULL,
	`raw_text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbox_expires_at_idx` ON `inbox` (`expires_at`);--> statement-breakpoint
CREATE TABLE `issuers` (
	`issuer_id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_alert_at` text
);
--> statement-breakpoint
CREATE TABLE `processed_events` (
	`agent` text NOT NULL,
	`event_id` text NOT NULL,
	`processed_at` text NOT NULL,
	PRIMARY KEY(`agent`, `event_id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`merchant_name` text NOT NULL,
	`cadence` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`category_id` text NOT NULL,
	`last_charged_at` text NOT NULL,
	`next_due_at` text,
	`dismissed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_merchant_cadence_idx` ON `subscriptions` (`merchant_name`,`cadence`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`occurred_at` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`merchant_raw` text,
	`merchant_name` text,
	`category_id` text NOT NULL,
	`category_confidence` real NOT NULL,
	`category_source` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`account_last4` text,
	`issuer_id` text,
	`txn_ref` text,
	`note` text,
	`linked_transaction_id` text
);
--> statement-breakpoint
CREATE INDEX `transactions_occurred_at_idx` ON `transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_idx` ON `transactions` (`merchant_name`);--> statement-breakpoint
CREATE INDEX `transactions_status_idx` ON `transactions` (`status`);--> statement-breakpoint
CREATE INDEX `transactions_txn_ref_idx` ON `transactions` (`issuer_id`,`txn_ref`);--> statement-breakpoint
CREATE TABLE `user_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`match_type` text NOT NULL,
	`pattern` text NOT NULL,
	`category_id` text NOT NULL,
	`kind` text,
	`hits` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_rules_pattern_idx` ON `user_rules` (`match_type`,`pattern`);