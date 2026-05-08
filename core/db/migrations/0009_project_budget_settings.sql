CREATE TABLE `project_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`per_workflow_max_usd` real,
	`per_agent_max_usd` real,
	`per_advisor_max_usd` real,
	`daily_tokens` integer,
	`max_parallel_agents` integer,
	`max_retries` integer,
	`max_bash_seconds` integer,
	`max_issues_per_day_from_non_owners` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `project_skill_settings` (
	`project_id` text NOT NULL,
	`skill_name` text NOT NULL,
	`max_turns` integer,
	`max_budget_usd` real,
	`timeout_ms` integer,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`project_id`, `skill_name`)
);
