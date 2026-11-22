CREATE TABLE `space_sounds` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`file` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_space_sounds_space` ON `space_sounds` (`space_id`);