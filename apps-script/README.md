# Apps Script — Document Merge / Consolidation Workflow

## Overview

A fully native Google Workspace workflow for the Echelon SG 2026 SME Challenge (Track 2: Save-a-Hire). Runs entirely inside Google Sheets using Apps Script — no server, no deployment, no OAuth complexity.

## Setup Instructions

### 1. Create the Template Sheet

1. Go to https://sheets.google.com and create a new spreadsheet.
2. Name it: `Template — The Social Space Workflow`
3. Go to **Extensions → Apps Script**

### 2. Deploy the Code

**Option A: Copy-paste (quickest)**
1. In the Apps Script editor, delete the default `Code.gs` content.
2. Create files matching the `.gs` names in this folder (Code.gs, Ingestion.gs, etc.).
3. Copy-paste the content from each file.
4. Click **Save** (Ctrl+S).

**Option B: clasp (for version control)**
```bash
npm install -g @google/clasp
clasp login
clasp create --type sheets --title "Template — The Social Space Workflow"
clasp push
```

### 3. Authorize

1. In the Apps Script editor, select any function (e.g., `onOpen`) and click **Run**.
2. Grant the requested permissions (Sheets, Drive, External Requests).
3. Reload the spreadsheet — the **The Social Space ▾** menu should appear.

### 4. Configure Settings

1. Click **The Social Space ▾ → Settings ▸ → Save API Key**
2. Fill in the Settings tab:
   - **AI Model**: choose Gemini (free), Qwen, or OpenAI
   - **API Key**: paste your key, then Save
   - **Folder IDs**: paste the Drive folder IDs for your structure
3. The Knowledge tab will seed with common corrections.

### 5. Create Drive Folders

Create this structure in Google Drive and paste each folder ID into Settings:

```
📁 The Social Space — Workflow/
├── 📁 Add CSV for Processing/
├── 📁 Archive CSV/
├── 📁 Archive Combined Files/
└── 📁 Reports/
```

### 6. Run the Workflow

1. Drop CSV files into the **Add CSV for Processing** folder.
2. Use the menu: **1. Combine CSVs** → **2. Run AI Review**
3. Review flagged cells, fix issues, tick **Human Verified**.
4. **4. Confirm & Generate Reports**

## Custom Menu Flow

```
The Social Space ▾
├── 1. Combine CSVs
├── 2. Run AI Review
├── 3. Re-Run AI Review (unverified only)
├── 4. Confirm & Generate Reports
└── Settings ▸
    ├── Save API Key
    ├── Reload Knowledge Tab
    └── Reset Template
```

## Tab Reference

| Tab | Purpose | Persists Reset? |
|-----|---------|-----------------|
| `Dashboard` | Status, instructions | Yes |
| `Settings` | AI model, API key, folders | Yes |
| `Knowledge` | Common corrections (auto-learns) | Yes |
| `Master` | Combined data table | No (cleared) |
| `Review Log` | AI findings per cell | No (cleared) |
| `Workflow Log` | Execution history | No (cleared) |

## Demo Flow (for judges)

1. Open the template → show the Dashboard and Settings tabs.
2. Drop sample CSVs into the Drive folder.
3. Menu → **1. Combine CSVs** → show Master tab populated.
4. Menu → **2. Run AI Review** → show cells with comments, Review Log.
5. Fix a flagged cell → show Knowledge tab learned the correction.
6. Tick the Human Verified column.
7. Menu → **4. Confirm & Generate Reports** → show Reports folder with per-partner sheets.
8. Show template is reset but Knowledge tab kept the correction.

## Multi-Model Support

| Model | Cost | Notes |
|-------|------|-------|
| Gemini 2.0 Flash | Free tier | Built-in Advanced Google Service |
| Qwen (Alibaba) | ~$0.002/call | Sponsor tech, via UrlFetchApp |
| OpenAI | ~$0.0015/call | Via UrlFetchApp |
| Custom | Varies | Configure endpoint, auth, body template in Settings |
