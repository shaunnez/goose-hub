ALTER TABLE `project_settings` ADD `implement_wp_contract_keywords_json` text;--> statement-breakpoint
ALTER TABLE `project_skill_settings` ADD `escalation_model_tier` text;--> statement-breakpoint
ALTER TABLE `project_skill_settings` ADD `escalation_max_budget_usd` real;--> statement-breakpoint
ALTER TABLE `project_skill_settings` ADD `escalation_max_turns` integer;--> statement-breakpoint
ALTER TABLE `project_skill_settings` ADD `escalation_timeout_ms` integer;
