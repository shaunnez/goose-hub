CREATE TABLE `archived_lifecycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`closed_at` text NOT NULL,
	`decision_summaries` text DEFAULT '[]' NOT NULL,
	`learning_entries` text DEFAULT '[]' NOT NULL,
	`quality_scores` text DEFAULT '[]' NOT NULL,
	`costs_usd` real DEFAULT 0 NOT NULL,
	`run_ids` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `archived_lifecycles_project_work_item_idx` ON `archived_lifecycles` (`project_id`,`work_item_id`);--> statement-breakpoint
CREATE INDEX `archived_lifecycles_project_closed_idx` ON `archived_lifecycles` (`project_id`,`closed_at`);--> statement-breakpoint
CREATE TABLE `decision_patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`role` text NOT NULL,
	`action_summary` text NOT NULL,
	`reason_summary` text DEFAULT '' NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`consistency_score` real DEFAULT 0 NOT NULL,
	`last_seen_at` text NOT NULL,
	`example_work_item_ids` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_patterns_project_kind_role_uniq` ON `decision_patterns` (`project_id`,`kind`,`role`);--> statement-breakpoint
CREATE INDEX `decision_patterns_project_idx` ON `decision_patterns` (`project_id`);