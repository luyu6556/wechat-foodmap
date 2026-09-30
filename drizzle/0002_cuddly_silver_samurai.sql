ALTER TABLE `places` ADD `cuisine` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `places` ADD `platform_rating` real;--> statement-breakpoint
ALTER TABLE `places` ADD `rating_count` integer;--> statement-breakpoint
ALTER TABLE `places` ADD `avg_price` integer;--> statement-breakpoint
ALTER TABLE `places` ADD `source_raw` text DEFAULT '' NOT NULL;