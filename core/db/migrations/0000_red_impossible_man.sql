CREATE TABLE `agent_run_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text,
	`stage` text NOT NULL,
	`skill` text NOT NULL,
	`model_id` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`cost_label` text DEFAULT 'estimated' NOT NULL,
	`persona_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_costs_run_id_uniq` ON `agent_run_costs` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_run_costs_project_created_idx` ON `agent_run_costs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_run_costs_work_item_idx` ON `agent_run_costs` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`run_id` text,
	`persona_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_project_created_idx` ON `events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `governance_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pr_url` text NOT NULL,
	`project_id` text NOT NULL,
	`ok` integer NOT NULL,
	`violations` text NOT NULL,
	`checked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `improvement_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`persona_name` text NOT NULL,
	`source_task_id` text,
	`suggestion_text` text NOT NULL,
	`suggestion_type` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`github_issue_url` text,
	`error_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `improvement_candidates_persona_status_idx` ON `improvement_candidates` (`persona_name`,`status`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'feature' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `persona_names` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`slot_index` integer NOT NULL,
	`codename` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_names_slot_uniq` ON `persona_names` (`project_id`,`role`,`slot_index`);--> statement-breakpoint
CREATE TABLE `persona_routing` (
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`last_index` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `role`)
);
--> statement-breakpoint
CREATE TABLE `persona_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`persona_name` text NOT NULL,
	`role` text NOT NULL,
	`runs_total` integer DEFAULT 0 NOT NULL,
	`runs_succeeded` integer DEFAULT 0 NOT NULL,
	`runs_failed` integer DEFAULT 0 NOT NULL,
	`avg_quality_score` real DEFAULT 1 NOT NULL,
	`last_run_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_stats_persona_role_uniq` ON `persona_stats` (`persona_name`,`role`);--> statement-breakpoint
CREATE TABLE `project_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`active_milestone_number` integer,
	`active_milestone_set_at` text,
	`active_milestone_set_by` text,
	`last_tick_at` text
);
