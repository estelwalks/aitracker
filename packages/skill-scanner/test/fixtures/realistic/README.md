# Realistic scanner fixtures

These fixtures exercise the public `scanSkill({ paths: [...] })` entry point. Risky
fixtures are inert text inputs: tests read them but never import, source, or execute
them. Domains use the reserved `.invalid` suffix and all credential values are
obvious non-secret placeholders.

## Expected quick-scan results

| Fixture | Expected rule IDs | Score | Verdict |
| --- | --- | ---: | --- |
| `positive/secret-exfiltration` | `READ_AWS_CREDS`, `CURL_POST_DOMAIN` | 20 | block |
| `positive/remote-download-execute` | `CURL_PIPE_SH_DOMAIN` | 90 | allow |
| `positive/persistence` | `SSH_KEYS_WRITE` | 10 | block |
| `positive/destructive-privilege` | `RM_RF_ROOT`, `SUDOERS_MODIFY` | 0 | block |
| `positive/obfuscated-execution` | `BASE64_DECODE_EXEC` | 40 | block |
| `positive/prompt-injection` | `IGNORE_INSTRUCTIONS` | 40 | block |
| `positive/multi-file-chain` | `HTTP_REQUEST` | 90 | allow |

The low-severity positive cases intentionally preserve the reference engine's
deduction-based score and verdict mapping; the test suite must not reinterpret
those outcomes.

Every directory under `negative/` must produce zero findings, score 100, and an
`allow` verdict in quick mode. The set covers normal DevOps release work,
documentation editing, a read-only HTTPS health check, placeholder configuration,
and download-verify-inspect installation guidance.

`positive/multi-file-chain` also runs in full mode with a deterministic mock model.
That test proves multi-file agent routing, cross-file semantic findings, static
aggregation, category totals, scoring, and final verdict behavior without making
an external request.

Run the suite with:

```sh
npm run test -- --coverage
```
