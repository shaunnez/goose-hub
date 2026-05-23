CREATE TABLE `agent_run_tool_stats` (
	`run_id` text PRIMARY KEY NOT NULL,
	`read_count` integer DEFAULT 0 NOT NULL,
	`grep_count` integer DEFAULT 0 NOT NULL,
	`write_count` integer DEFAULT 0 NOT NULL,
	`edit_count` integer DEFAULT 0 NOT NULL,
	`bytes_read` integer DEFAULT 0 NOT NULL,
	`unique_paths_read` integer DEFAULT 0 NOT NULL,
	`redundant_reads` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
