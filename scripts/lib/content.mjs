export const CREATOR_NAME = "John Braybrooke";

// Minimal frontmatter reader for controlled site content. Values are
// single-line strings, empty arrays, or arrays of quoted strings.
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data = {};

  if (!match) {
    return { data, body: text.trim() };
  }

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf(":");

    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rest = line.slice(separator + 1).trim();
    data[key] = parseFrontmatterValue(rest);
  }

  const body = text.slice(match[0].length).trim();
  return { data, body };
}

function parseFrontmatterValue(value) {
  if (value === "[]") {
    return [];
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    return parseQuotedArray(value);
  }

  if (value.startsWith('"')) {
    return value.slice(1, value.lastIndexOf('"'));
  }

  return value;
}

function parseQuotedArray(value) {
  const inner = value.slice(1, -1).trim();

  if (!inner) {
    return [];
  }

  const items = [];
  let index = 0;

  while (index < inner.length) {
    while (/\s/.test(inner[index])) {
      index += 1;
    }

    if (inner[index] !== '"') {
      return value;
    }

    const end = inner.indexOf('"', index + 1);

    if (end === -1) {
      return value;
    }

    items.push(inner.slice(index + 1, end));
    index = end + 1;

    while (/\s/.test(inner[index])) {
      index += 1;
    }

    if (index >= inner.length) {
      break;
    }

    if (inner[index] !== ",") {
      return value;
    }

    index += 1;
  }

  return items;
}
