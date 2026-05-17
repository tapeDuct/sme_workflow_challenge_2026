# Report Agent — Echelon SG 2026
# The Social Space: Consignment Reporting Automation

## Quick Start

```bash
cd "Report Agent"
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your Qwen API key
python agent.py
```

## What it does

1. Scans `input/` for CSV/ODS files
2. Combines and normalizes them into a master table
3. AI reviews every cell — auto-fixes what it can, flags the rest
4. You interactively approve fixes
5. Generates per-partner reports in `output/`

## Folder Layout

```
Report Agent/
├── agent.py              # Interactive CLI — run this
├── modules/              # Business logic
├── input/                # Drop source files here
├── output/               # Reports land here
├── corrections/          # Common fixes reference
├── context/              # Agent knowledge
└── run.log               # Activity log
```

## Requirements

- Python 3.10+
- Qwen API key (Alibaba Cloud Model Studio)
- No other paid services required
