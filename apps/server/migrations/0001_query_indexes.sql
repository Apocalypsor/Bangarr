-- Adopt databases created before Drizzle migration tracking without recreating existing objects.
CREATE INDEX IF NOT EXISTS `candidates_job_state` ON `candidates` (`job_id`,`state`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `candidates_state` ON `candidates` (`state`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_dedupe_key` ON `jobs` (`dedupe_key`);