CREATE TABLE `wp_iterations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`wp_id` text NOT NULL,
	`iteration` integer NOT NULL,
	`status` text NOT NULL,
	`error_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wp_iterations_run_wp_iteration_uniq` ON `wp_iterations` (`run_id`,`wp_id`,`iteration`);--> statement-breakpoint
CREATE INDEX `wp_iterations_run_wp_idx` ON `wp_iterations` (`run_id`,`wp_id`);