# Echelon Singapore 2026 — SME Workflow Automation

**Track 2: Save-a-Hire (Operational Efficiency & Task Automation) - Python Cloud Solution**

A production-ready AI workflow that minimizes manual labor, optimizes SME efficiency, and keeps humans in the loop for critical decisions.

---

## Quick Start

```bash
git clone <repo-url> && cd echelon-sg-2026
make setup        # creates venv, installs deps, copies .env
# Edit .env with your API keys
make run          # starts at http://localhost:8000
make test         # runs test suite
make lint         # runs ruff
```

### Docker
```bash
docker compose up
```

---

## Architecture

| Layer | What it does |
|-------|-------------|
| **Input** | PDF (pymupdf), images (vision), text |
| **AI** | Qwen Model Studio — extraction + confidence scoring |
| **Safety** | PII detection/masking, confidence thresholds, explainability |
| **Triage** | Auto-approve (≥85% confidence) or route to human |
| **HITL** | Email-based approve/reject with callback URLs |
| **Output** | Structured JSON → DB, orders, reports, Zapier triggers |
| **Metrics** | Live dashboard: tasks, time saved, cost breakdown |

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/tasks` | Create a workflow task |
| `GET` | `/tasks` | List all tasks |
| `GET` | `/tasks/{id}` | Get task details |
| `POST` | `/tasks/{id}/run` | Execute the full workflow |
| `GET` | `/hitl/email-approve/{id}` | Human approves from email |
| `GET` | `/hitl/email-reject/{id}` | Human rejects from email |
| `GET` | `/metrics` | Real-time metrics snapshot |
| `GET` | `/summary` | Aggregate workflow stats |
| `GET` | `/integrations/search?q=` | Brave Search |
| `POST` | `/integrations/zapier` | Zapier webhook trigger |

Full docs at `/docs` when running.

---

## Tech Stack

- **Backend:** Python 3.11, FastAPI
- **AI:** Qwen (Alibaba Cloud Model Studio), OpenAI-compatible
- **Database:** SQLite (zero-setup, portable)
- **Integrations:** Brave Search, Apollo, Zapier
- **Deploy:** Docker, Bitdeer AI / FPT AI Factory (sponsor GPU infra)

## Directory Structure

```
src/
├── main.py          # FastAPI entry point, all routes
├── config.py        # Settings from .env
├── models.py        # Pydantic schemas
├── ai.py            # Qwen provider + AI assurance (PII, confidence)
├── hitl.py          # Email-based human-in-the-loop
├── services.py      # Extraction, verification, generation, metrics
├── integrations.py  # Brave, Apollo, Zapier
└── db.py            # SQLite via SQLAlchemy

docs/
├── ARCHITECTURE.md  # System design + workflow diagrams
├── COST.md          # Detailed cost analysis
├── AI_SAFETY.md     # Responsible AI practices
└── DEMO.md          # 5-minute judge presentation script
```
