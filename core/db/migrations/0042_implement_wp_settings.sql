ALTER TABLE `project_settings` ADD `implement_wp_edit_test_loop_max_cycles` integer;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_bug_max_turns` integer;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_bug_max_budget_usd` real;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_feature_max_turns` integer;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_feature_max_budget_usd` real;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_complex_max_turns` integer;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_complex_max_budget_usd` real;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_high_priority_usd` real;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_many_files_threshold` integer;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_many_files_usd` real;--> statement-breakpoint
ALTER TABLE `project_settings` ADD `implement_wp_contract_usd` real;
