CREATE TABLE `project_dev_review_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`enabled` integer,
	`trigger_on` text,
	`max_revision_turns` integer,
	`per_cycle_max_usd` real,
	`timeout_ms` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_by` text
);
