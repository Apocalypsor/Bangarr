-- Validate the legacy account before removing its only stored copy. This
-- temporary guard is local to this migration and is rolled back on failure.
CREATE TEMP TABLE `_legacy_plex` (
  `value` text NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `valid_legacy_plex` CHECK (coalesce(
    json_type(value, '$.url') = 'text' AND length(json_extract(value, '$.url')) BETWEEN 1 AND 2048
    AND json_type(value, '$.token') = 'text' AND length(json_extract(value, '$.token')) <= 2048
    AND json_type(value, '$.userName') = 'text' AND length(json_extract(value, '$.userName')) BETWEEN 1 AND 100
    AND json_type(value, '$.enabled') IN ('true', 'false')
    AND json_type(value, '$.cron') = 'text' AND length(json_extract(value, '$.cron')) <= 100
    AND json_type(value, '$.libraryIds') = 'array' AND json_array_length(value, '$.libraryIds') <= 100,
    0
  ))
);
--> statement-breakpoint
INSERT INTO `_legacy_plex` (`value`, `updated_at`)
SELECT json_extract(value, '$.plex'), updated_at FROM settings
WHERE key = 'app'
  AND length(json_extract(value, '$.plex.url')) > 0
  AND length(json_extract(value, '$.plex.userName')) > 0
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'plex-accounts');
--> statement-breakpoint
-- A CHECK cannot contain a subquery; invalidate malformed library entries
-- through the same guard before writing any permanent settings.
UPDATE `_legacy_plex` SET value = json_set(value, '$.libraryIds', null)
WHERE EXISTS (
  SELECT 1 FROM json_each(_legacy_plex.value, '$.libraryIds')
  WHERE type <> 'text' OR length(value) = 0 OR value GLOB '*[^0-9]*'
);
--> statement-breakpoint
INSERT INTO settings (`key`, `value`, `updated_at`)
SELECT 'plex-accounts', json_array(json_set(value,
  '$.id', 'default', '$.name', json_extract(value, '$.userName'), '$.serverId', ''
)), updated_at FROM `_legacy_plex`;
--> statement-breakpoint
-- Existing account lists (including []) take precedence. Preserve real account
-- IDs; translate only the legacy default account's username and deduplicate.
WITH sources AS (
  SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.userName') AS username
  FROM json_each((SELECT value FROM settings WHERE key = 'plex-accounts'))
)
UPDATE accounts SET plex_users = (
  SELECT json_group_array(binding) FROM (
    SELECT DISTINCT CASE
      WHEN EXISTS (SELECT 1 FROM sources WHERE id = bindings.value) THEN bindings.value
      WHEN bindings.value = (SELECT username FROM sources WHERE id = 'default') THEN 'default'
      ELSE bindings.value
    END AS binding
    FROM json_each(accounts.plex_users) AS bindings
  )
)
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'default')
  AND EXISTS (SELECT 1 FROM settings WHERE key = 'app' AND json_type(value, '$.plex') IS NOT NULL);
--> statement-breakpoint
UPDATE settings SET value = json_remove(value, '$.plex')
WHERE key = 'app' AND json_type(value, '$.plex') IS NOT NULL;
--> statement-breakpoint
DROP TABLE `_legacy_plex`;
