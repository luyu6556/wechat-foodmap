CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text,
	`member_name` text DEFAULT '' NOT NULL,
	`member_color` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
