CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`member_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`place_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`place_id`, `member_id`),
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_token_hash_unique` ON `members` (`token_hash`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`member_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`category` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`source_text` text DEFAULT '' NOT NULL,
	`source_url` text,
	`source_platform` text DEFAULT 'manual' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ratings` (
	`place_id` text NOT NULL,
	`member_id` text NOT NULL,
	`score` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`place_id`, `member_id`),
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`place_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`place_id`, `member_id`),
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
