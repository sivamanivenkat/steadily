CREATE TABLE `failed_events` (
	`agent` text NOT NULL,
	`event_id` text NOT NULL,
	`attempts` integer NOT NULL,
	`last_error_name` text NOT NULL,
	`gave_up` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`agent`, `event_id`)
);
--> statement-breakpoint
CREATE TABLE `runtime_cursors` (
	`name` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`updated_at` text NOT NULL
);
