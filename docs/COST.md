# Cost Analysis

## Setup Costs

| Item | Cost |
|------|------|
| Development environment | $0 (local) |
| Docker hosting (demo) | $0 (local) |
| Bitdeer GPU / FPT AI Factory inference | $0 (sponsor credits) |

## Per-Transaction Costs (Estimated)

| Step | Service | Est. Cost/Task |
|------|---------|----------------|
| Document parsing (pymupdf) | Local | $0 |
| AI extraction (Qwen) | Alibaba Cloud | $0.002 — $0.01 |
| Human review email | SMTP | ~$0.0001 |
| Brave Search (enrichment) | Brave API | ~$0.001/query |
| Apollo enrichment | Apollo API | ~$0.001/query |
| Zapier trigger | Zapier | ~$0.001/trigger |

**Estimated total: ~$0.03/task** (fully automated)
**With human review: ~$0.035/task** (plus human time)

## Monthly Operating Costs (at scale)

| Volume | Tasks/Month | Auto Cost | Human-Review Cost (20%) |
|--------|------------|-----------|------------------------|
| Pilot | 500 | $15 | $19 |
| Medium | 5,000 | $150 | $190 |
| Production | 50,000 | $1,500 | $1,900 |

## Value Delivered vs. Manual Alternative

| Metric | Manual | Automated (This Workflow) |
|--------|--------|---------------------------|
| Time per document | 15 min | 0.5 min (auto) / 2 min (with review) |
| Error rate | ~5-8% | ~1-2% |
| Staff cost/month (5,000 docs) | ~$2,500+ | ~$150-190 |
| Scalability | Linear (hire more) | Sub-linear (same system) |

## Key Assumptions

- Qwen API costs are approximations based on current pricing tiers
- Document sizes: ~5-10 pages average
- 80% of tasks auto-complete without human intervention
- Human review takes ~1-2 minutes per flagged task
