DROP INDEX `mapping_title_season`;--> statement-breakpoint
ALTER TABLE `mappings` ADD `episode` integer DEFAULT -1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_title_season_episode` ON `mappings` (`title`,`season`,`episode`);