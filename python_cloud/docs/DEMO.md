# 5-Minute Demo Script

## Narrative: "Save-a-Hire — AI Workflow for SME Operations"

### 00:00-00:30 — The Problem (SME Impact)
> "SMEs waste 15+ hours per week on manual data entry — extracting info from PDFs, entering customer orders from WhatsApp, verifying data. This is repetitive, error-prone, and doesn't scale. Every hour spent on data entry is an hour not spent on growth."

### 00:30-01:30 — Live Demo: Document Extraction
1. Open `http://localhost:8000/docs` — show the FastAPI docs
2. Create a task via `POST /tasks`:
   ```json
   {"task_type": "invoice_extraction", "input_type": "pdf", "file_path": "data/examples/sample-invoice.pdf"}
   ```
3. Run the workflow: `POST /tasks/{id}/run`
4. Show the extracted structured data in the response
5. Show task status: `GET /tasks/{id}` — "Auto-completed in 3 seconds"

### 01:30-02:30 — Human-in-the-Loop (Responsible AI)
1. Create a task with intentionally ambiguous data
2. Run workflow → show it returns "awaiting_human" status
3. Show what the email looks like: extracted data, confidence score, approve/reject links
4. Click "Approve" → show task completing
5. Explain: "When AI is unsure, a human decides. No blind automation."

### 02:30-03:30 — Cost & Metrics (Cost Efficiency)
1. Show `GET /metrics` — tasks processed, auto vs. human, time saved
2. Show `GET /summary` — estimated hours saved, cost per task (~$0.03)
3. Reference the cost analysis: "5000 documents/month = $150 vs. $2500+ in staff costs"

### 03:30-04:30 — The Architecture (Technical Execution)
1. Pull up `docs/ARCHITECTURE.md`
2. Walk the flow: Input → Extraction → AI (Qwen) → Triage → Auto/Human → Output
3. Show tests: `make test` or the CI badge
4. Show Docker: `docker compose up` — one command to deploy

### 04:30-05:00 — SME Value Summary
> "This workflow lets a 5-person SME do the work of 10. $150/month vs. $2,500+ in headcount. Safe, explainable, production-ready. Track 2 — Save-a-Hire."

## Backup Slides / Data
- `docs/COST.md` — printed cost breakdown
- `docs/AI_SAFETY.md` — responsible AI practices
- `GET /metrics` — live dashboard of savings
