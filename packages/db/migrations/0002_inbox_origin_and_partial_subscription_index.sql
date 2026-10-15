DROP INDEX `subscriptions_merchant_cadence_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_merchant_cadence_idx` ON `subscriptions` (`merchant_name`,`cadence`) WHERE "subscriptions"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE `inbox` ADD `origin_app` text;--> statement-breakpoint
ALTER TABLE `inbox` ADD `origin_sender` text;