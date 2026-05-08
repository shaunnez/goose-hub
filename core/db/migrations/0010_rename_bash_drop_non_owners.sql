ALTER TABLE `project_settings` DROP COLUMN `max_bash_seconds`;--> statement-breakpoint
ALTER TABLE `project_settings` DROP COLUMN `max_issues_per_day_from_non_owners`;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `per_bash_command_max_seconds` integer;
