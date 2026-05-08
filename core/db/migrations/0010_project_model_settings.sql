CREATE TABLE `project_model_settings` (
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`primary_model` text,
	`fallback_model` text,
	`advisor_model` text,
	`complexity_overrides_json` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`project_id`, `role`)
);
