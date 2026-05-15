# Architecture

## System Overview

```
                    ┌──────────────────────────────────────────┐
                    │              SME Workflow Input          │
                    │   PDF  │  Image  │  Text  │  Messenger   │
                    └────────┬─────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │       Extraction Service      │
              │   (pymupdf / vision / text)   │
              └──────────┬───────────────────┘
                         │
                         ▼
              ┌──────────────────────────────┐
              │        AI Processing          │
              │   Qwen Model Studio API       │
              │   Structured data extraction  │
              └──────────┬───────────────────┘
                         │
                    ┌────▼────┐
                    │  Triage  │
                    │ Service  │
                    └─┬─────┬──┘
                      │     │
            High Conf │     │ Low Conf
                      │     │
                      ▼     ▼
              ┌─────────┐  ┌──────────────────┐
              │  Auto-   │  │  Human-in-the-Loop│
              │ approve  │  │  (Email Review)   │
              └────┬─────┘  └────────┬─────────┘
                   │                 │
                   ▼    ┌────────────▼──────────┐
              ┌────────┐│  Approve / Reject /   │
              │ Output  ││  Revise via Email     │
              │ Generate│└───────────┬───────────┘
              └────┬─────┘            │
                   │                  ▼
                   │         ┌──────────────┐
                   │         │  Re-process  │
                   │         │  with human   │
                   │         │  corrections │
                   │         └──────┬───────┘
                   │                │
                   ▼                ▼
           ┌──────────────────────────────┐
           │         Final Output          │
           │  DB │ Orders │ Reports │ API  │
           └──────────────────────────────┘
```

## Components

| Layer | Component | Responsibility |
|-------|-----------|---------------|
| Input | `services.py:extraction` | Parse PDFs (pymupdf), images (vision), text |
| AI | `ai.py:AIProvider` | Qwen Model Studio — chat, structured extraction |
| Safety | `ai.py:Assurance` | PII detection/masking, confidence thresholds, explainability |
| Routing | `services.py:verification` | Confidence-based triage → auto vs. human review |
| HITL | `hitl.py:EmailHandler` | Email-based approval/rejection with callback URLs |
| Output | `services.py:generation` | Structured output generation (orders, DB entries) |
| Persistence | `db.py` | SQLite task tracking, audit log |
| Metrics | `services.py:metrics` | Time saved, cost per task, auto vs. human rates |

## Human-in-the-Loop Flow

```
1. AI extracts data → confidence score calculated
2. If confidence < threshold (default: 0.85):
   a. Email sent to reviewer with extracted data + approve/reject links
   b. Low-confidence fields highlighted
3. Human clicks Approve → task auto-completes
4. Human clicks Reject → task flagged for manual processing
```

## Data Privacy

- PII is detected and masked **before** any data is sent to AI APIs
- Supported patterns: credit cards, NRIC, phone numbers, email addresses
- Sanitized responses logged for audit
