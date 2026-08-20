/** Generated inline migration for Nitro's single-file server bundle.
 * Keep byte-identical with 0007_model_profile_auth.sql (LF normalized). */
export const PLATFORM_MIGRATION_0007_SQL = `-- AITracker local storage database — migration 0007 "model profile auth".
-- Persist the selected authentication header scheme for model profiles.
-- NULL is retained for legacy rows and resolves to the protocol default.

ALTER TABLE model_profiles ADD COLUMN auth TEXT
  CHECK (auth IS NULL OR auth IN ('x-api-key', 'bearer'));
`;
