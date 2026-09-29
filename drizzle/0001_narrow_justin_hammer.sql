CREATE TABLE `member_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `members` ADD `wechat_openid` text;--> statement-breakpoint
ALTER TABLE `members` ADD `is_owner` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `members_wechat_openid_unique` ON `members` (`wechat_openid`);