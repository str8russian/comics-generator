-- provider_io_started NULL means the terminal update has not confirmed I/O.
-- http_status stores an observed provider response status, not a mapped product status.

ALTER TABLE image_generation_attempt
  ALTER COLUMN provider_io_started DROP NOT NULL;

ALTER TABLE image_generation_attempt
  ALTER COLUMN provider_io_started DROP DEFAULT;

UPDATE image_generation_attempt
SET provider_io_started = NULL
WHERE state = 'prepared'
  AND provider_io_started = false;

COMMENT ON COLUMN image_generation_attempt.provider_io_started IS
  'NULL while non-terminal: provider I/O is not durably confirmed. TRUE after the terminal update for the single provider attempt.';

COMMENT ON COLUMN image_generation_attempt.http_status IS
  'HTTP status observed on a provider response. NULL when no provider response was observed.';
