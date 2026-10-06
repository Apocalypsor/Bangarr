CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`access_token` text NOT NULL,
	`plex_users` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE `admins` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL
);

CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`title` text NOT NULL,
	`season` integer NOT NULL,
	`choices` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "candidates_state_check" CHECK("candidates"."state" IN ('pending', 'confirmed', 'rejected'))
);

CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`available_at` integer NOT NULL,
	`lease_until` integer,
	`lease_owner` text,
	`last_error` text,
	`result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "jobs_state_check" CHECK("jobs"."state" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled'))
);

CREATE INDEX `jobs_ready` ON `jobs` (`state`,`available_at`);
CREATE UNIQUE INDEX `jobs_active_key` ON `jobs` (`dedupe_key`) WHERE "jobs"."state" IN ('pending', 'running');
CREATE TABLE `mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`season` integer NOT NULL,
	`subject_id` integer NOT NULL,
	`episode_offset` integer DEFAULT 0 NOT NULL,
	`resolve_series` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);

CREATE UNIQUE INDEX `mapping_title_season` ON `mappings` (`title`,`season`);
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`account_id` text,
	`title` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`media_type` text NOT NULL,
	`plex_user` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`subject_id` integer,
	`episode_id` integer,
	`message` text NOT NULL,
	`trace` text NOT NULL,
	`created_at` integer NOT NULL
);

CREATE INDEX `records_created` ON `records` (`created_at`);
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`admin_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE `watched` (
	`scope` text NOT NULL,
	`rating_key` text NOT NULL,
	`account_id` text NOT NULL,
	`subject_id` integer NOT NULL,
	`episode_id` integer NOT NULL,
	`created_at` integer NOT NULL
);

CREATE UNIQUE INDEX `watched_identity` ON `watched` (`scope`,`rating_key`,`account_id`);
