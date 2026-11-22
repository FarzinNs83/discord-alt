CREATE TABLE `space_event_rsvps` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `space_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `space_events` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`channel_id` text,
	`title` text NOT NULL,
	`starts_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_space_events_space_starts` ON `space_events` (`space_id`,`starts_at`);