CREATE TABLE `poll_options` (
	`poll_id` text NOT NULL,
	`place_id` text NOT NULL,
	`place_name` text DEFAULT '' NOT NULL,
	`place_address` text DEFAULT '' NOT NULL,
	`place_cuisine` text DEFAULT '' NOT NULL,
	`place_avg_price` integer,
	`place_platform_rating` real,
	`place_average_rating` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`poll_id`, `place_id`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`poll_id` text NOT NULL,
	`place_id` text NOT NULL,
	`member_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`poll_id`, `member_id`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `polls` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`closed_by` text,
	`closed_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `polls_single_open` ON `polls` (`status`) WHERE "polls"."status" = 'open';