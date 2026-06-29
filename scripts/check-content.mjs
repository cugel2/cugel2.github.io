import assert from "node:assert/strict";
import { parseFrontmatter } from "./lib/content.mjs";
import { markdownToPlainText, renderMarkdownLite } from "./lib/notes.mjs";

const parsed = parseFrontmatter(`---
title: "Array check"
related_photos: ["photo-00004", "photo-00007"]
empty: []
---
Body`);

assert.deepEqual(parsed.data.related_photos, ["photo-00004", "photo-00007"]);
assert.deepEqual(parsed.data.empty, []);

const html = renderMarkdownLite(`A **bold** field note with *emphasis* and [a link](/notes/). <No raw HTML>`);
assert.equal(
  html,
  '<p>A <strong>bold</strong> field note with <em>emphasis</em> and <a href="/notes/">a link</a>. &lt;No raw HTML&gt;</p>'
);
assert.equal(markdownToPlainText("A [linked note](/notes/) with **weight**."), "A linked note with weight.");

console.log("Content parser checks passed.");
