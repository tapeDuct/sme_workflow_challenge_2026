# The Social Space — Consignment Reporting Challenge

## Problem
The Social Space is a Singapore social enterprise with 50+ consignment partners. Each month, they manually generate per-partner sales and inventory reports — a process taking **1.5 weeks** across 3 disconnected data sources (POS, online store, corporate orders).

## Data
- **Input:** CSV/ODS files with sales, inventory, revenue per SKU per location
- **Locations:** Kreta Ayer, Potong Pasir, Online
- **Partner column:** item_category (Item category)
- **Key columns:** Sales outlets, Item description, Item Number, Item category, Current Inventory, Sales volume, Revenue, Total selling price

## Output
Per-partner CSV reports in output/ with:
- Location, SKU, Description, Quantity, Revenue, Unit Price

## Roles
**item_category** = partner. Common values include: Riau Candle, Happiness Initiative, CRAFTERS STUDIO, Doodle Dat, etc.
