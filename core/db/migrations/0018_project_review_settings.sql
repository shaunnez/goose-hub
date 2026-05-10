CREATE TABLE `project_review_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`reviewer_slots` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_by` text
);
