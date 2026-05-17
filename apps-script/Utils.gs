/**
 * Shared utilities.
 */

/**
 * Find the index of a header in a headers array (0-based).
 */
function headerIndex(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].toString().toLowerCase() === name.toLowerCase()) return i;
  }
  return -1;
}

/**
 * Find the first matching column from a list of candidate names.
 * Returns the 0-based index, or -1 if none match.
 */
function findColumn(headers, candidates) {
  for (var c = 0; c < candidates.length; c++) {
    var idx = headerIndex(headers, candidates[c]);
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Sanitize a string for use as a sheet name (remove illegal chars, truncate to 100).
 */
function sanitizeSheetName(name) {
  return name.toString()
    .replace(/[\/\\\*\?\[\]\:]/g, '_')
    .replace(/\'/g, '')
    .substring(0, 100);
}

/**
 * Parse a JSON response that might be wrapped in markdown code blocks or have extra text.
 */
function extractJSON(text) {
  text = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.substring(start, end + 1);
  }
  start = text.indexOf('[');
  end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    return text.substring(start, end + 1);
  }
  return text;
}

/**
 * Safe number parsing.
 */
function safeParseFloat(val, defaultVal) {
  defaultVal = defaultVal || 0;
  if (val === undefined || val === null || val === '') return defaultVal;
  var num = parseFloat(val);
  return isNaN(num) ? defaultVal : num;
}
