import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CREATOR_NAME, parseFrontmatter } from "./content.mjs";
import { SITE_URL } from "./photos.mjs";

const cwd = process.cwd();
const notesDirectory = path.join(cwd, "content", "notes");
const noteFilename = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function renderInlineMarkdown(value) {
  const linkPattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g;
  let html = "";
  let lastIndex = 0;

  for (const match of value.matchAll(linkPattern)) {
    html += renderEmphasis(escapeHtml(value.slice(lastIndex, match.index)));
    html += `<a href="${escapeAttribute(match[2])}">${renderEmphasis(escapeHtml(match[1]))}</a>`;
    lastIndex = match.index + match[0].length;
  }

  html += renderEmphasis(escapeHtml(value.slice(lastIndex)));
  return html;
}

function renderEmphasis(value) {
  return value
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

export function renderMarkdownLite(markdown) {
  return String(markdown ?? "")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim().replace(/\s*\n\s*/g, " "))
    .filter(Boolean)
    .map((paragraph) => `<p>${renderInlineMarkdown(paragraph)}</p>`)
    .join("\n");
}

export function markdownToPlainText(markdown) {
  return String(markdown ?? "")
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveSummary(markdown) {
  const text = markdownToPlainText(markdown);

  if (text.length <= 180) {
    return text;
  }

  return `${text.slice(0, 177).replace(/\s+\S*$/, "")}...`;
}

export function displayNoteTitle(note) {
  return note.title || `Note from ${note.dateLabel}`;
}

function prettyDate(iso) {
  const date = new Date(`${iso}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

async function noteFiles() {
  const entries = await readdir(notesDirectory, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".md")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export async function loadNotes(photos) {
  const photoIds = new Set(photos.map((photo) => photo.id));
  const files = await noteFiles();
  const notes = [];
  const errors = [];

  for (const file of files) {
    const match = file.match(noteFilename);
    const id = path.basename(file, ".md");

    if (!match) {
      errors.push(`${file}: filename must be YYYY-MM-DD-short-slug.md`);
      continue;
    }

    const datePrefix = match[1];
    const text = await readFile(path.join(notesDirectory, file), "utf8");
    const { data, body } = parseFrontmatter(text);
    const date = String(data.date || "").trim();
    const title = String(data.title || "").trim();
    const summary = String(data.summary || "").trim();
    const relatedPhotos = data.related_photos ?? [];

    if (!date) {
      errors.push(`${file}: fill in date`);
    } else if (date !== datePrefix) {
      errors.push(`${file}: date must match filename prefix ${datePrefix}`);
    }

    if (!body.trim()) {
      errors.push(`${file}: note body is required`);
    }

    if (!Array.isArray(relatedPhotos)) {
      errors.push(`${file}: related_photos must be [] or an array like ["photo-00004"]`);
    } else {
      for (const photoId of relatedPhotos) {
        if (!photoIds.has(photoId)) {
          errors.push(`${file}: related_photos references missing photo ${photoId}`);
        }
      }
    }

    notes.push({
      id,
      url: `${SITE_URL}/notes/${id}/`,
      path: `/notes/${id}/`,
      date,
      dateLabel: prettyDate(date),
      title,
      summary: summary || deriveSummary(body),
      body,
      bodyHtml: renderMarkdownLite(body),
      creator: CREATOR_NAME,
      related_photos: Array.isArray(relatedPhotos) ? relatedPhotos : []
    });
  }

  if (errors.length) {
    throw new Error(`Note metadata is incomplete:\n  - ${errors.join("\n  - ")}`);
  }

  return notes.sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }

    return a.id.localeCompare(b.id);
  });
}
