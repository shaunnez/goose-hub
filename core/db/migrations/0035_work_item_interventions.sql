CREATE TABLE `work_item_interventions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `intervention_type` text NOT NULL,
  `status` text NOT NULL,
  `title` text NOT NULL,
  `reason` text NOT NULL,
  `root_cause_signature` text NOT NULL,
  `correlation_id` text NOT NULL,
  `source_event_id` integer,
  `proposed_options_json` text NOT NULL DEFAULT '[]',
  `decided_action_type` text,
  `decided_action_payload_json` text,
  `decided_by` text,
  `decision_reason` text,
  `application_result_json` text,
  `verification_json` text,
  `lease_owner` text,
  `lease_expires_at` text,
  `version` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  `updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  `resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `work_item_interventions_project_status_idx` ON `work_item_interventions` (`project_id`, `status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `work_item_interventions_work_item_status_idx` ON `work_item_interventions` (`work_item_id`, `status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `work_item_interventions_root_cause_idx` ON `work_item_interventions` (`project_id`, `work_item_id`, `root_cause_signature`);
--> statement-breakpoint
CREATE TABLE `work_item_intervention_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `intervention_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `event_type` text NOT NULL,
  `actor` text NOT NULL,
  `from_status` text,
  `to_status` text,
  `payload_json` text NOT NULL DEFAULT '{}',
  `correlation_id` text NOT NULL,
  `created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX `work_item_intervention_events_intervention_idx` ON `work_item_intervention_events` (`intervention_id`, `id`);
--> statement-breakpoint
CREATE INDEX `work_item_intervention_events_project_work_item_idx` ON `work_item_intervention_events` (`project_id`, `work_item_id`, `id`);
