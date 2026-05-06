CREATE TABLE `playbooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`window_start_at` text NOT NULL,
	`window_end_at` text NOT NULL,
	`lifecycle_count` integer DEFAULT 0 NOT NULL,
	`manifest` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `playbooks_project_created_idx` ON `playbooks` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `playbooks_project_window_idx` ON `playbooks` (`project_id`,`window_start_at`,`window_end_at`);