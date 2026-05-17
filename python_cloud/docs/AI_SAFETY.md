# Responsible AI & AI Assurance

## Safety Measures

| Concern | Implementation | Location |
|---------|---------------|----------|
| **PII Exposure** | Detection + masking before AI API calls | `src/ai.py:Assurance.detect_pii()` |
| **Data leakage** | PII redacted; no raw data stored in logs | `src/ai.py:Assurance.mask_pii()` |
| **AI hallucination** | Confidence scoring per field; low-confidence → human | `src/ai.py:AIProvider._parse_json_with_confidence()` |
| **Escalation** | Automatic routing to human when confidence < 85% | `src/ai.py:Assurance.should_escalate()` |

## Fairness & Transparency

- **Explainable decisions**: Low-confidence fields are explicitly identified and sent to humans for review with explanations
- **Audit trail**: Every task records status transitions, confidence scores, and human notes in SQLite (`src/db.py`)
- **No automated final decisions**: Human always has veto power via email approve/reject
- **Confidence thresholds are configurable**: Organizations can tune thresholds per domain

## Compliance

- **Data residency**: All processing happens within the deployment region; no cross-border data transfer unless configured
- **Auditability**: Complete task history with timestamps in `tasks` table
- **Human oversight**: Required for all low-confidence extractions; humans can also sample high-confidence outputs

## Testing

| Test Type | Coverage |
|-----------|----------|
| PII detection (NRIC, phone, email, credit card) | `tests/test_workflow.py` |
| PII masking | `tests/test_workflow.py` |
| Confidence threshold escalation | `tests/test_workflow.py` |
| Extraction with high/low confidence | `tests/test_workflow.py` |
| CI automated testing | `.github/workflows/ci.yml` |

## Safe-Use Practices

1. **Never blind auto-commit**: All low-confidence outputs wait for human review
2. **Principle of least privilege**: API keys scoped to minimum required permissions
3. **Fail-safe defaults**: Failed extraction → human review, not silent error
4. **Regular confidence calibration**: Thresholds should be reviewed against domain data
