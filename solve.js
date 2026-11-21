// solve.js — a faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answer as csv-reader for every input {text, header}: {columns, rows, errors}.
// The reference is written to be plain and easy to check, not fast: one character at a
// time, each field built up a character at a time. This module keeps the exact same
// broken-row policy but reads in bulk instead:
//
//   - an unquoted field is found by scanning for its next delimiter (comma, LF, CR)
//     with one regex exec and slicing the whole run at once, instead of appending one
//     character at a time;
//   - a quoted field is found by scanning for its next special character (quote, CR,
//     LF) the same way, so a plain quoted field costs one regex exec plus one slice;
//   - stray CRs (the only thing that splits an unquoted field) are rare, so the field
//     is kept as one slice in the common case and only joined from segments when a
//     stray CR actually appears;
//   - line numbers are tracked only at the delimiters and line breaks that the scan
//     already lands on, never by walking the text character by character.
//
// Policy (identical to csv-reader 1.0.0):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, and each CRLF or lone CR inside it is read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended to
//     it as it stands (quote_junk, when the field ends); a quote that never closes
//     is read as a literal character and the text after it is read again as an
//     unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings,
//     never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its count) or cut (long_row, with extra: the cut
//     fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on
//     (every LF, CRLF and lone CR inside a quoted field counted), row its record's
//     index in rows (null for the header), in the order met, a field's quote_junk
//     when the field ends and a record's short_row or long_row when the record ends.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.
// JavaScript only, no dependencies, no WASM, no native addons.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** Next delimiter of an unquoted field: comma, CR or LF. */
const DELIM_RE = /[,\r\n]/g;
/** Next special character inside a quoted field: quote, CR or LF. */
const QUOTE_RE = /["\r\n]/g;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field and how it ended; `added` counts the characters kept. The field is one slice
  // unless a stray CR splits it, in which case its segments are joined.
  function readUnquoted(value) {
    let added = 0;
    let parts = null;
    for (;;) {
      DELIM_RE.lastIndex = pos;
      const m = DELIM_RE.exec(text);
      if (m === null) {
        const tail = text.slice(pos);
        pos = n;
        if (parts === null) return { value: value + tail, ended: END, added: added + tail.length };
        parts.push(tail);
        return { value: value + parts.join(''), ended: END, added: added + tail.length };
      }
      const i = m.index;
      const ci = text.charCodeAt(i);
      if (ci === 44) { // ','
        const seg = text.slice(pos, i);
        pos = i + 1;
        if (parts === null) return { value: value + seg, ended: COMMA, added: added + seg.length };
        parts.push(seg);
        return { value: value + parts.join(''), ended: COMMA, added: added + seg.length };
      }
      if (ci === 10) { // '\n'
        const seg = text.slice(pos, i);
        pos = i + 1;
        line += 1;
        if (parts === null) return { value: value + seg, ended: LINE_BREAK, added: added + seg.length };
        parts.push(seg);
        return { value: value + parts.join(''), ended: LINE_BREAK, added: added + seg.length };
      }
      // '\r' (13)
      if (text.charCodeAt(i + 1) === 10) { // CRLF
        const seg = text.slice(pos, i);
        pos = i + 2;
        line += 1;
        if (parts === null) return { value: value + seg, ended: LINE_BREAK, added: added + seg.length };
        parts.push(seg);
        return { value: value + parts.join(''), ended: LINE_BREAK, added: added + seg.length };
      }
      // A lone CR: stray_cr, dropped, the field goes on.
      error('stray_cr');
      const seg = text.slice(pos, i);
      if (parts === null) parts = [];
      parts.push(seg);
      added += seg.length;
      pos = i + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let cur = pos + 1;
    let segStart = cur;
    let parts = null;
    for (;;) {
      QUOTE_RE.lastIndex = cur;
      const m = QUOTE_RE.exec(text);
      if (m === null) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      const i = m.index;
      const ci = text.charCodeAt(i);
      if (ci === 34) { // '"'
        if (text.charCodeAt(i + 1) === 34) {
          // A doubled quote is one literal quote in the value.
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, i));
          parts.push('"');
          cur = i + 2;
          segStart = i + 2;
          continue;
        }
        // The closing quote. The run from segStart to here holds no quote, CR or LF.
        let value;
        if (parts === null) value = text.slice(segStart, i);
        else {
          parts.push(text.slice(segStart, i));
          value = parts.join('');
        }
        pos = i + 1;
        if (pos >= n) return { value, ended: END };
        const nc = text.charCodeAt(pos);
        if (nc === 44) { // ','
          pos += 1;
          return { value, ended: COMMA };
        }
        if (nc === 10) { // '\n'
          pos += 1;
          line += 1;
          return { value, ended: LINE_BREAK };
        }
        if (nc === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
          pos += 2;
          line += 1;
          return { value, ended: LINE_BREAK };
        }
        // What follows the closing quote is appended as it stands, up to the next comma or line break.
        const junk = readUnquoted(value);
        if (junk.added > 0) error('quote_junk');
        return junk;
      }
      if (ci === 13) { // '\r' inside quotes: CRLF and a lone CR are each one LF.
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i));
        parts.push('\n');
        line += 1;
        cur = text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
        segStart = cur;
        continue;
      }
      // '\n' inside quotes: one LF, one line.
      if (parts === null) parts = [];
      parts.push(text.slice(segStart, i));
      parts.push('\n');
      line += 1;
      cur = i + 1;
      segStart = i + 1;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { // '\n'
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
