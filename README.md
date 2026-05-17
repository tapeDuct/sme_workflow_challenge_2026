# Echelon Singapore 2026 — SME Workflow Challenge

**Track 2: Save-a-Hire (Operational Efficiency & Task Automation)**

Automate Monthly Consignment Reporting.

This repo contains all implementations of the workflow across different approaches:

| Folder | Approach | Status |
|--------|----------|--------|
| [`python_cloud/`](python_cloud/) | Python microservice (FastAPI + Qwen + Google Sheets) | Built |
| [`custom_agent/`](custom_agent/) | OpenCode AI agent | Built |
| [`apps_script/`](apps_script/) | Google Apps Script | Built | https://docs.google.com/presentation/d/1oMc7ewMhYxxd94oQdxIJbT07Qvmchc9CsCEuCFLl1UY/edit?usp=sharing 
| [`web_app/`](web_app/) | Replit-hosted web application | Built | https://data-wrangler-pro-tapeduct.replit.app

## The Problem

A Singapore social enterprise with 50+ consignment partners, spends 1.5 weeks per month manually generating per-partner sales and inventory reports from 3 disconnected data sources (POS, online store, corporate orders). Reports are error-prone and late.

## The Solution

An AI-powered workflow that:
- Ingests CSVs from Google Drive
- Combines and cleans data automatically
- Uses AI for data quality review with human-in-the-loop for ambiguous entries
- Generates per-partner Google Sheets reports

## Tech Stack (python_cloud)

- Python 3.11, FastAPI
- Qwen (Alibaba Cloud Model Studio)
- Google Sheets API + Drive API (OAuth)
- SQLite, Pandas
- Docker, GitHub Actions CI
