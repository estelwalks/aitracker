/** Generated inline migration for Nitro's single-file server bundle.
 * Keep byte-identical with 0006_memory_body.sql (LF normalized). */
export const PLATFORM_MIGRATION_0006_SQL = `-- AITracker local storage database — migration 0006 "memory body".
-- M6 lets memory-kind knowledge versions persist their display body so the
-- memory hub card and Markdown export show the full AI-distilled or manually
-- entered memory (PRD FR-014 标题+正文), instead of a 160-char provenance
-- fragment. The body is the safety-filtered, user-approved memory product —
-- never raw conversation content. Raw content stays absent from the schema;
-- provenance rows remain opaque session:<source>:<id> references.

ALTER TABLE knowledge_versions ADD COLUMN content TEXT
  CHECK (content IS NULL OR length(content) <= 24000);
`;
