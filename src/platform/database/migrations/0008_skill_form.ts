/** Generated inline migration for Nitro's single-file server bundle.
 * Keep byte-identical with 0008_skill_form.sql (LF normalized). */
export const PLATFORM_MIGRATION_0008_SQL =
  `-- TrustTools local storage database — migration 0008 "skill form".
-- Persist the SKILL.md frontmatter ` +
  "`form`" +
  ` (package/workflow/prompt) so the
-- skill management page can filter by 形态. NULL for legacy rows resolves to package.

ALTER TABLE skills ADD COLUMN form TEXT
  CHECK (form IS NULL OR form IN ('package', 'workflow', 'prompt'));
`;
