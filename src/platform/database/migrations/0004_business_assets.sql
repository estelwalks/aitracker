-- AITracker local storage database — migration 0004 "business assets".
-- M4 moves user-owned reports/knowledge/distillation metadata, security
-- assessments and distribution audit records to normalized STRICT tables.
-- Knowledge and scanner source bodies are deliberately absent from the schema.

CREATE TABLE report_runs (
  run_id TEXT PRIMARY KEY,
  task_run_id TEXT REFERENCES task_runs (run_id) ON DELETE SET NULL,
  definition_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'offline', 'budget-exceeded')),
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  error_code TEXT,
  retryable INTEGER CHECK (retryable IS NULL OR retryable IN (0, 1)),
  ai_request_id TEXT REFERENCES ai_executions (request_id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_report_runs_definition_started
  ON report_runs (definition_id, started_at_ms DESC);

CREATE TABLE report_run_evidence (
  run_id TEXT NOT NULL REFERENCES report_runs (run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  module TEXT NOT NULL CHECK (module IN ('usage', 'insights', 'security', 'knowledge', 'tasks')),
  evidence_ref TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  PRIMARY KEY (run_id, sequence)
) STRICT;

CREATE TABLE reports (
  report_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES report_runs (run_id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'archived')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 60000),
  generated_at_ms INTEGER NOT NULL CHECK (generated_at_ms >= 0),
  template_version INTEGER NOT NULL CHECK (template_version >= 0),
  approved_by TEXT,
  approved_at_ms INTEGER CHECK (approved_at_ms IS NULL OR approved_at_ms >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE INDEX idx_reports_definition_generated
  ON reports (definition_id, generated_at_ms DESC);

CREATE TABLE report_evidence (
  report_id TEXT NOT NULL REFERENCES reports (report_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  module TEXT NOT NULL CHECK (module IN ('usage', 'insights', 'security', 'knowledge', 'tasks')),
  evidence_ref TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  PRIMARY KEY (report_id, sequence)
) STRICT;

CREATE TABLE report_assets (
  report_id TEXT NOT NULL REFERENCES reports (report_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('knowledge', 'chart', 'attachment')),
  PRIMARY KEY (report_id, asset_id, kind)
) STRICT;

CREATE TABLE knowledge_assets (
  asset_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'brief', 'snippet', 'document', 'other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  security_verdict TEXT CHECK (security_verdict IS NULL OR security_verdict IN ('clean', 'suspicious', 'dangerous', 'unknown')),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE knowledge_metadata (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

INSERT INTO knowledge_metadata (singleton_id, revision) VALUES (1, 0);

CREATE INDEX idx_knowledge_assets_status_kind_updated
  ON knowledge_assets (status, kind, updated_at_ms DESC, asset_id DESC);

CREATE TABLE knowledge_versions (
  version_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES knowledge_assets (asset_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'brief', 'snippet', 'document', 'other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  content_ref TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  security_verdict TEXT CHECK (security_verdict IS NULL OR security_verdict IN ('clean', 'suspicious', 'dangerous', 'unknown')),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  audit_action TEXT NOT NULL,
  audit_actor TEXT NOT NULL,
  UNIQUE (asset_id, version)
) STRICT;

CREATE INDEX idx_knowledge_versions_content_hash
  ON knowledge_versions (content_hash);

CREATE TABLE knowledge_provenance (
  version_id TEXT NOT NULL REFERENCES knowledge_versions (version_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  source_ref TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('session', 'report', 'distillation', 'manual', 'unknown')),
  captured_at_ms INTEGER NOT NULL CHECK (captured_at_ms >= 0),
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 160),
  PRIMARY KEY (version_id, sequence)
) STRICT;

CREATE INDEX idx_knowledge_provenance_source_ref
  ON knowledge_provenance (source_ref);

CREATE TABLE distillation_candidates (
  candidate_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'brief', 'prompt', 'persona', 'skill')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary TEXT NOT NULL CHECK (length(summary) <= 16000),
  mode TEXT NOT NULL CHECK (mode IN ('model', 'offline', 'fallback', 'budget-exceeded')),
  approval_state TEXT NOT NULL CHECK (approval_state IN ('waiting-approval', 'approved', 'cancelled')),
  generated_at_ms INTEGER NOT NULL CHECK (generated_at_ms >= 0),
  ai_request_id TEXT NOT NULL UNIQUE REFERENCES ai_executions (request_id) ON DELETE RESTRICT,
  execution_model_id TEXT NOT NULL,
  execution_provider_id TEXT,
  execution_prompt_version_id TEXT NOT NULL,
  execution_prompt_version INTEGER NOT NULL CHECK (execution_prompt_version >= 0),
  execution_status TEXT NOT NULL CHECK (execution_status IN ('completed', 'offline', 'fallback', 'budget-exceeded', 'timeout', 'cancelled', 'failed')),
  execution_used_fallback INTEGER NOT NULL CHECK (execution_used_fallback IN (0, 1)),
  execution_cost_confidence TEXT NOT NULL CHECK (execution_cost_confidence IN ('exact', 'estimated', 'unknown')),
  execution_cost_microusd INTEGER CHECK (execution_cost_microusd IS NULL OR execution_cost_microusd >= 0),
  execution_cost_reason TEXT NOT NULL CHECK (execution_cost_reason IN ('priced', 'estimated', 'no-pricing', 'offline')),
  execution_error_code TEXT,
  approved_at_ms INTEGER CHECK (approved_at_ms IS NULL OR approved_at_ms >= 0),
  cancelled_at_ms INTEGER CHECK (cancelled_at_ms IS NULL OR cancelled_at_ms >= 0),
  knowledge_asset_id TEXT REFERENCES knowledge_assets (asset_id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_distillation_candidates_state_generated
  ON distillation_candidates (approval_state, generated_at_ms DESC);

CREATE TABLE distillation_candidate_sessions (
  candidate_id TEXT NOT NULL REFERENCES distillation_candidates (candidate_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 7),
  source_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (candidate_id, sequence)
) STRICT;

CREATE TABLE security_scan_runs (
  scan_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('quick', 'full')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'automatic')),
  locale TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'partial', 'failed', 'cancelled')),
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_code TEXT,
  rule_version TEXT
) STRICT;

CREATE INDEX idx_security_scan_runs_started
  ON security_scan_runs (started_at_ms DESC);
CREATE INDEX idx_security_scan_runs_status_started
  ON security_scan_runs (status, started_at_ms);

CREATE TABLE security_assessments (
  assessment_ref TEXT PRIMARY KEY,
  scan_id TEXT REFERENCES security_scan_runs (scan_id) ON DELETE SET NULL,
  asset_ref TEXT NOT NULL,
  asset_hash_ref TEXT,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('skill', 'package', 'knowledge', 'distillation')),
  display_name TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('clean', 'suspicious', 'dangerous', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'failed', 'skipped', 'cancelled')),
  rule_version TEXT NOT NULL,
  rule_provenance TEXT NOT NULL CHECK (rule_provenance IN ('builtin', 'local', 'unknown')),
  rule_pack_ref TEXT,
  assessed_at_ms INTEGER NOT NULL CHECK (assessed_at_ms >= 0),
  files_scanned INTEGER CHECK (files_scanned IS NULL OR files_scanned >= 0),
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code TEXT
) STRICT;

CREATE INDEX idx_security_assessments_asset_assessed
  ON security_assessments (asset_ref, assessed_at_ms DESC);
CREATE INDEX idx_security_assessments_verdict_assessed
  ON security_assessments (verdict, assessed_at_ms DESC);
CREATE INDEX idx_security_assessments_scan
  ON security_assessments (scan_id);

CREATE TABLE security_findings (
  finding_ref TEXT PRIMARY KEY,
  assessment_ref TEXT NOT NULL REFERENCES security_assessments (assessment_ref) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
  dimension TEXT,
  rule_id TEXT,
  evidence_ref TEXT NOT NULL,
  title_key TEXT,
  detail_params_json TEXT CHECK (detail_params_json IS NULL OR json_valid(detail_params_json))
) STRICT;

CREATE INDEX idx_security_findings_assessment_severity
  ON security_findings (assessment_ref, severity);
CREATE INDEX idx_security_findings_status_severity
  ON security_findings (status, severity);

CREATE TABLE distribution_runs (
  run_id TEXT PRIMARY KEY,
  plan_ref TEXT NOT NULL,
  skill_ref TEXT,
  operation TEXT NOT NULL DEFAULT 'install' CHECK (operation IN ('install', 'sync', 'uninstall', 'export')),
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'succeeded', 'partial', 'failed', 'rolled-back')),
  requested_at_ms INTEGER NOT NULL CHECK (requested_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  actor TEXT NOT NULL DEFAULT 'local',
  rollback_ref TEXT,
  error_code TEXT
) STRICT;

CREATE INDEX idx_distribution_runs_requested
  ON distribution_runs (requested_at_ms DESC);

CREATE TABLE distribution_run_targets (
  run_id TEXT NOT NULL REFERENCES distribution_runs (run_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'rolled-back', 'skipped')),
  installation_ref TEXT,
  error_code TEXT,
  backup_ref TEXT,
  PRIMARY KEY (run_id, agent_id)
) STRICT;

CREATE VIEW v_latest_security_assessment AS
SELECT a.* FROM security_assessments a
WHERE NOT EXISTS (
  SELECT 1 FROM security_assessments newer
  WHERE newer.asset_ref = a.asset_ref
    AND (newer.assessed_at_ms > a.assessed_at_ms
      OR (newer.assessed_at_ms = a.assessed_at_ms AND newer.assessment_ref > a.assessment_ref))
);

CREATE VIEW v_latest_reports AS
SELECT r.* FROM reports r
WHERE NOT EXISTS (
  SELECT 1 FROM reports newer
  WHERE newer.definition_id = r.definition_id
    AND (newer.generated_at_ms > r.generated_at_ms
      OR (newer.generated_at_ms = r.generated_at_ms AND newer.report_id > r.report_id))
);

CREATE VIEW v_active_model_profile AS
SELECT profile_id, name, mode, protocol, endpoint, model, is_active, created_at_ms, updated_at_ms
FROM model_profiles WHERE is_active = 1;
