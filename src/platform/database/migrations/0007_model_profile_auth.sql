-- AITracker local storage database — migration 0007 "model profile auth".
-- Persist the selected authentication header scheme for model profiles.
-- NULL is retained for legacy rows and resolves to the protocol default.

ALTER TABLE model_profiles ADD COLUMN auth TEXT
  CHECK (auth IS NULL OR auth IN ('x-api-key', 'bearer'));
