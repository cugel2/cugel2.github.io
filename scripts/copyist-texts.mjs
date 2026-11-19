#!/usr/bin/env node
// Builds Copyist's library from Project Gutenberg plain-text files.
//
//   node scripts/copyist-texts.mjs <source-dir>
//
// <source-dir> holds the Gutenberg files (not committed):
//   kjv.txt            Gutenberg #10   The King James Bible
//   shakespeare.txt    Gutenberg #100  The Complete Works (UTF-8 edition, 100-0.txt)
//   gibbon1.txt … gibbon6.txt   Gutenberg #731–736  Decline and Fall, volumes 1–6
//
// Writes copyist/texts/manifest.json and one JSON file per book, play, poem
// or chapter. Each file is { units: [{ title, text }] }, where text uses the
// small markup copyist.js reads:
//   # Heading            shown, not typed
//   [Direction]          shown, not typed (a whole block)
//   {inline}             shown, not typed (inside a line)
//   @SPEAKER. words      speaker shown, not typed
//   12 words             verse number in the margin
//   blank line           new block; a single newline is a line break

import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/copyist-texts.mjs <source-dir>"); process.exit(1); }
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "copyist", "texts");

function read(name) {
  return fs.readFileSync(path.join(src, name), "utf8").replace(/^﻿/, "").replace(/\r/g, "");
}
function body(text) {
  const start = text.search(/^\*\*\* ?START OF (THIS|THE) PROJECT GUTENBERG.*$/m);
  const end = text.search(/^\*\*\* ?END OF (THIS|THE) PROJECT GUTENBERG/m);
  if (start < 0 || end < 0) throw new Error("Gutenberg markers not found");
  let out = text.slice(text.indexOf("\n", start) + 1, end);
  const tail = out.search(/^End of (the )?Project Gutenberg/im);
  if (tail > 0) out = out.slice(0, tail);
  return out;
}
const slug = (s) => s.toLowerCase().replace(/’|'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const countWords = (markup) => markup.split("\n").filter((l) => !/^(# |\[)/.test(l))
  .map((l) => l.replace(/^@\S+\s*/, "").replace(/^\d+ /, "").replace(/\{[^}]*\}/g, ""))
  .join(" ").split(/\s+/).filter(Boolean).length;
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function roman(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]], next = ROMAN[s[i + 1]] || 0;
    n += v < next ? -v : v;
  }
  return n;
}

function writeText(id, meta, parts) {
  const dir = path.join(OUT, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const manifestParts = parts.map((p, i) => {
    const file = `${id}/${String(i + 1).padStart(2, "0")}-${p.id}.json`;
    fs.writeFileSync(path.join(OUT, file), JSON.stringify({ units: p.units }));
    return { id: p.id, title: p.title, file, units: p.units.map((u) => ({ title: u.title, words: countWords(u.text) })) };
  });
  const words = manifestParts.reduce((a, p) => a + p.units.reduce((b, u) => b + u.words, 0), 0);
  console.log(`${id}: ${parts.length} parts, ${manifestParts.reduce((a, p) => a + p.units.length, 0)} units, ${words.toLocaleString()} words`);
  return { id, ...meta, words, parts: manifestParts };
}

// ---------------------------------------------------------------- KJV
const KJV_BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther",
  "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations",
  "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
  "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
  "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy",
  "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude",
  "Revelation"];

function buildKJV() {
  const lines = body(read("kjv.txt")).split("\n");
  // A book starts at each "1:1 " line; its title is the last other line before it.
  const starts = [];
  lines.forEach((l, i) => { if (/^1:1 /.test(l)) starts.push(i); });
  if (starts.length !== 66) throw new Error(`KJV: expected 66 books, found ${starts.length}`);
  const parts = starts.map((s, b) => {
    const end = b + 1 < starts.length ? starts[b + 1] : lines.length;
    // Drop the next book's title and any testament heading from the tail.
    let chunk = lines.slice(s, end);
    let last = chunk.length - 1;
    while (last > 0 && !/\d+:\d+ /.test(chunk[last])) last--;
    // keep continuation lines of the final verse: up to the first blank line after `last`
    let stop = last;
    while (stop + 1 < chunk.length && chunk[stop + 1].trim()) stop++;
    chunk = chunk.slice(0, stop + 1);
    const flat = chunk.join(" ").replace(/\s+/g, " ").trim();
    const verses = [...flat.matchAll(/(\d+):(\d+) (.*?)(?= \d+:\d+ |$)/g)];
    const chapters = [];
    for (const [, c, v, t] of verses) {
      const ci = Number(c) - 1;
      if (!chapters[ci]) chapters[ci] = [];
      chapters[ci].push(`${v} ${t.trim()}`);
    }
    const name = KJV_BOOKS[b];
    const units = chapters.map((vs, i) => {
      const title = name === "Psalms" ? `Psalm ${i + 1}` : `${name} ${i + 1}`;
      return { title, text: `# ${title}\n\n${vs.join("\n\n")}` };
    });
    return { id: slug(name), title: name, units };
  });
  return writeText("kjv", { title: "The King James Bible", short: "King James Bible", author: "", kind: "verse",
    group: (p) => null }, parts);
}

// ---------------------------------------------------------------- Shakespeare
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(“‘-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Of|The|And|In|To|A|An|For|With|At|By|On|Or)\b/g, (w, _x, off) => off === 0 ? w : w.toLowerCase())
  .replace(/’S\b/g, "’s");
const PLAY_SHORT = {
  "THE TRAGEDY OF ANTONY AND CLEOPATRA": "Antony and Cleopatra", "THE TRAGEDY OF CORIOLANUS": "Coriolanus",
  "THE TRAGEDY OF HAMLET, PRINCE OF DENMARK": "Hamlet", "THE FIRST PART OF KING HENRY THE FOURTH": "Henry IV, Part 1",
  "THE SECOND PART OF KING HENRY THE FOURTH": "Henry IV, Part 2", "THE LIFE OF KING HENRY THE FIFTH": "Henry V",
  "THE FIRST PART OF HENRY THE SIXTH": "Henry VI, Part 1", "THE SECOND PART OF KING HENRY THE SIXTH": "Henry VI, Part 2",
  "THE THIRD PART OF KING HENRY THE SIXTH": "Henry VI, Part 3", "KING HENRY THE EIGHTH": "Henry VIII",
  "THE TRAGEDY OF JULIUS CAESAR": "Julius Caesar", "THE TRAGEDY OF KING LEAR": "King Lear",
  "THE TRAGEDY OF MACBETH": "Macbeth", "THE TRAGEDY OF OTHELLO, MOOR OF VENICE": "Othello",
  "PERICLES, PRINCE OF TYRE": "Pericles", "KING RICHARD THE SECOND": "Richard II", "KING RICHARD THE THIRD": "Richard III",
  "THE TRAGEDY OF ROMEO AND JULIET": "Romeo and Juliet", "THE LIFE OF TIMON OF ATHENS": "Timon of Athens",
  "THE TRAGEDY OF TITUS ANDRONICUS": "Titus Andronicus", "THE HISTORY OF TROILUS AND CRESSIDA": "Troilus and Cressida",
  "TWELFTH NIGHT; OR, WHAT YOU WILL": "Twelfth Night", "CYMBELINE": "Cymbeline", "KING JOHN": "King John",
  "THE COMEDY OF ERRORS": "The Comedy of Errors",
};
const POEMS = ["THE SONNETS", "A LOVER’S COMPLAINT", "THE PASSIONATE PILGRIM", "THE PHOENIX AND THE TURTLE",
  "THE RAPE OF LUCRECE", "VENUS AND ADONIS"];

function buildShakespeare() {
  let text = body(read("shakespeare.txt"));
  const note = text.search(/^\s*\*\s*CONTENT NOTE/m); // 2017 transcriber's note at the very end
  if (note > 0) text = text.slice(0, note);
  const lines = text.split("\n");
  // The contents list gives every title; each work starts at the title's next occurrence.
  const ci = lines.findIndex((l) => l.trim() === "Contents");
  const titles = [];
  for (let i = ci + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (lines[i] === t) break; // contents entries are indented; the first unindented line ends it
    titles.push(t);
  }
  let from = ci + titles.length;
  const starts = titles.map((t) => {
    const at = lines.findIndex((l, i) => i > from && l.trim().replace(/[:.]$/, "") === t && !/^\s{3}/.test(l));
    if (at < 0) throw new Error("Shakespeare: title not found: " + t);
    from = at;
    return at;
  });
  const works = titles.map((t, k) => ({ t, lines: lines.slice(starts[k] + 1, k + 1 < starts.length ? starts[k + 1] : lines.length) }));

  const parts = [];
  for (const w of works) {
    const name = PLAY_SHORT[w.t] || titleCase(w.t);
    if (w.t === "THE SONNETS") parts.push({ id: "sonnets", title: "The Sonnets", poem: true, units: sonnets(w.lines) });
    else if (POEMS.includes(w.t)) parts.push({ id: slug(name), title: name, poem: true, units: poem(name, w.lines) });
    else parts.push({ id: slug(name), title: name, units: play(name, w.lines) });
  }
  // Plays alphabetically (ignoring "The"), then poems with the Sonnets first.
  const key = (p) => p.title.replace(/^The /, "");
  const plays = parts.filter((p) => !p.poem).sort((a, b) => key(a).localeCompare(key(b)));
  const poems = parts.filter((p) => p.poem);
  return writeText("shakespeare", { title: "Shakespeare", short: "Shakespeare", author: "William Shakespeare", kind: "play" },
    [...poems.filter((p) => p.id === "sonnets"), ...plays, ...poems.filter((p) => p.id !== "sonnets")]);
}

function clean(s) {
  return s.replace(/_/g, "").replace(/\s+/g, " ").trim();
}

function sonnets(lines) {
  const units = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^\s+(\d+)\s*$/);
    if (m) { cur = { n: m[1], lines: [] }; units.push(cur); continue; }
    if (cur && l.trim()) cur.lines.push(clean(l));
  }
  return units.map((u) => ({ title: `Sonnet ${u.n}`, text: `# Sonnet ${u.n}\n\n${u.lines.join("\n")}` }));
}

// Poems whose dedications pass for verse: the text starts at this line.
const POEM_FIRST_LINE = {
  "Venus and Adonis": /^Even as the sun with purple/,
  "The Rape of Lucrece": /^From the besieged Ardea/,
};
function poem(name, lines) {
  if (POEM_FIRST_LINE[name]) {
    const at = lines.findIndex((l) => POEM_FIRST_LINE[name].test(l.trim()));
    if (at < 0) throw new Error("first line not found in " + name);
    lines = lines.slice(at);
  }
  // Stanzas separated by blank lines; drop the byline and headings; group into ~120-line units.
  const stanzas = [];
  let cur = [];
  const flush = () => { if (cur.length) stanzas.push(cur); cur = []; };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { flush(); continue; }
    if (/^by William Shakespeare$/i.test(l)) continue;
    cur.push(raw);
  }
  flush();
  const out = [];
  let unit = [], count = 0;
  const push = () => {
    if (!unit.length) return;
    const n = out.length + 1;
    out.push({ title: `${name}, part ${n}`, blocks: unit });
    unit = []; count = 0;
  };
  let started = false;
  for (const s of stanzas) {
    const t = s.map((l) => l.trim());
    const isHead = t.length <= 2 && t.every((l) => l === l.toUpperCase() || /^[IVXLC]+\.?$/.test(l));
    const isProse = t.reduce((a, l) => a + l.length, 0) / t.length > 58;
    // Everything before the first verse stanza is title page, dedication or argument: skip it.
    if (!started && (isHead || isProse)) continue;
    started = true;
    if (isHead) {
      const h = clean(t.join(" "));
      if (h.toUpperCase() !== name.toUpperCase() && !/^(FINIS|THE END)\.?$/.test(h)) unit.push(`# ${h}`);
      continue;
    }
    if (t.length === 1 && /^(FINIS|THE END)\.?$/.test(t[0])) continue;
    const verse = t.map((l) => clean(l).replace(/\s+\d{1,4}$/, "")); // printed line numbers
    unit.push(isProse ? verse.join(" ") : verse.join("\n"));
    count += s.length;
    if (count >= 120) push();
  }
  push();
  if (out.length === 1) out[0].title = name;
  return out.map((u, i) => ({ title: u.title, text: [`# ${out.length > 1 ? `${name} · ${i + 1} of ${out.length}` : name}`, ...u.blocks].join("\n\n") }));
}

// The Complete Works file mixes two layouts:
//   A: speaker on its own unindented line ("HAMLET."), speech below, directions indented one space.
//   B: "  HAMLET. To be…" with the speaker inline, continuations indented four spaces,
//      directions unindented or deeply indented, and exits right-aligned at the end of lines.
const SPEAKER_A = /^([A-Z][A-Z0-9’'.,&\- ]*[A-Z’]\.?)$/;
const SPEAKER_B = /^ {2}([A-Z][A-Z’'\-]+(?: (?:of|OF|[A-Z][A-Z’'\-]*))*\.)\s+(\S.*)$/;
const DIRECTION_WORD = /^(Enter|Re-enter|Exit|Exeunt|Flourish|Alarum|Alarums|Sennet|Trumpets?|Music|Thunder|Hautboys|Drums?|March|Retreat|Dies|Dumb|Sound|Excursions|Noise|Cornets|Shout|Storm|Solemn|Loud|Lightning|A flourish|A march|A sennet|A tucket|Tucket|Song|They|Manet|Manent|Kneels|Knocking|Knock|Bell|Horns?|Within|Sleeps|Wakes)\b/;
const ACT_RE = /^(?:[A-Z][A-Z’' ]* )?ACT ([IVX]+|\d+)\.?(?:\s+SCENE ([IVX]+|\d+)\.?\s*(.*))?$/;
const SCENE_RE = /^SCENE ([IVX]+|\d+)\.?\s*(.*)$/;
const SPECIAL_RE = /^(THE )?(PROLOGUE|EPILOGUE|INDUCTION)\.?(?: (?:THE )?(?:PROLOGUE|EPILOGUE|INDUCTION)\.?)?$|^(Prologue|Epilogue|Induction)\.?$/;
const num = (s) => /^\d+$/.test(s) ? Number(s) : roman(s);

const DIRECTION_STRICT = /^(Enter|Re-enter|Exit|Exeunt|Flourish|Alarum|Alarums|Sennet|Hautboys|Excursions|Manet|Manent)\b/;
function play(name, lines) {
  // A third layout indents everything six spaces; take that indent off first.
  const filled = lines.filter((l) => l.trim());
  if (filled.filter((l) => /^ {6}\S/.test(l)).length > filled.length * 0.6) lines = lines.map((l) => l.replace(/^ {6}/, ""));
  const layoutB = lines.filter((l) => SPEAKER_B.test(l)).length > 40;
  // Skip contents and cast list: start at the first unindented ACT/SCENE/PROLOGUE/INDUCTION heading.
  let i = lines.findIndex((l) => /Dramatis Person|PERSONS REPRESENTED/i.test(l));
  if (i < 0) i = 0;
  const isStart = (l) => l === l.trimStart() && (ACT_RE.test(l.trim()) || SCENE_RE.test(l.trim()) || SPECIAL_RE.test(l.trim()));
  const nextText = (k) => { while (++k < lines.length && !lines[k].trim()); return lines[k] || ""; };
  while (i < lines.length && !(isStart(lines[i]) && !/^Scene [IVX]+\./.test(nextText(i)))) i++;
  if (i >= lines.length) throw new Error("Shakespeare: no start found in " + name);

  const units = [];
  let act = null, unit = null, blocks = null, speech = null;
  const endSpeech = () => {
    if (speech && speech.lines.length) blocks.push(speech.who ? `@${speech.who} ${speech.lines.join("\n")}` : speech.lines.join("\n"));
    speech = null;
  };
  const newUnit = (title, place) => {
    endSpeech();
    blocks = [`# ${name} · ${title}`];
    if (place) blocks.push(`[${place}]`);
    unit = { title, blocks };
    units.push(unit);
  };
  const direction = (d) => { endSpeech(); blocks.push(`[${clean(d).replace(/^\[(.*)\]$/, "$1")}]`); };
  const say = (t) => {
    // right-aligned exits: "…our pomp.     Exit PHILOSTRATE"
    let tail = "";
    const m = t.match(/^(.*\S)\s{4,}([A-Z][^ ].{0,60})$/);
    if (m && DIRECTION_WORD.test(m[2])) { t = m[1]; tail = m[2]; }
    t = t.replace(/\[_?([^\]]*?)_?\]/g, (_, d) => `{${clean(d)}}`).replace(/_/g, "").replace(/\s+/g, " ").trim();
    if (tail) t += ` {${clean(tail)}}`;
    if (/^\{[^}]*\}$/.test(t)) { direction(t.slice(1, -1)); return; } // a line that is only a direction
    if (!speech) speech = { who: "", lines: [] };
    const prev = speech.lines[speech.lines.length - 1];
    if (prev && /^[a-z]/.test(t) && prev.length > 55) speech.lines[speech.lines.length - 1] += " " + t;
    else speech.lines.push(t);
  };

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();
    if (!l) continue;
    if (/^ACT_\d/.test(l)) continue;
    if (/^THE END\.?$/.test(l) && raw === l) break;
    let m;
    const head = raw === l || /^\s{10,}/.test(raw);
    if (head && (m = l.match(ACT_RE))) {
      act = num(m[1]);
      endSpeech(); unit = null;
      if (m[2]) newUnit(`Act ${toRoman(act)}, Scene ${num(m[2])}`, clean(m[3] || ""));
      continue;
    }
    if (head && (m = l.match(SCENE_RE)) && (raw === l || /^SCENE ([IVX]+|\d+)\.?$/.test(l))) {
      newUnit(act ? `Act ${toRoman(act)}, Scene ${num(m[1])}` : `Induction, Scene ${num(m[1])}`, clean(m[2]));
      continue;
    }
    // Prologue/Induction only open a section before the acts or straight after an ACT heading,
    // Epilogue only near the end; elsewhere "PROLOGUE." is a speaker (Hamlet's players).
    const special = SPECIAL_RE.test(l) && (/EPILOGUE|Epilogue/.test(l) ? (act || 0) >= 4 : act === null || unit === null);
    if ((raw === l || /^\s{10,}/.test(raw)) && special) {
      const title = titleCase(l.replace(/\./g, "").replace(/^THE /, "").split(" ")[0]);
      if (!(unit && unit.title === title && blocks.length <= 2)) newUnit(title, "");
      continue;
    }
    if (!unit) newUnit(act ? `Act ${toRoman(act)}, Chorus` : "Opening", "");

    if (!layoutB) {
      if (raw !== l) {
        let d = l;
        while (i + 1 < lines.length && lines[i + 1].startsWith(" ") && lines[i + 1].trim()) d += " " + lines[++i].trim();
        direction(d);
        continue;
      }
      if (DIRECTION_STRICT.test(l) && !(lines[i - 1] || "").trim()) {
        let d = l;
        while (i + 1 < lines.length && lines[i + 1].trim()) d += " " + lines[++i].trim();
        direction(d);
        continue;
      }
      if (SPEAKER_A.test(l) && l.length < 40 && /[A-Z]{2}/.test(l)) {
        endSpeech();
        speech = { who: l.replace(/\s+/g, " "), lines: [] };
        continue;
      }
      say(l);
      continue;
    }

    // layout B
    if ((m = raw.match(SPEAKER_B))) {
      endSpeech();
      speech = { who: m[1].replace(/\s+/g, " "), lines: [] };
      say(m[2]);
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0 || (indent >= 5 && DIRECTION_WORD.test(l))) {
      let d = l;
      while (i + 1 < lines.length && lines[i + 1].trim() && (indent === 0 ? !/^\s/.test(lines[i + 1]) : lines[i + 1].length - lines[i + 1].trimStart().length >= 5) && !SPEAKER_B.test(lines[i + 1])) d += " " + lines[++i].trim();
      direction(d);
      continue;
    }
    say(l);
  }
  endSpeech();
  return units.filter((u) => u.blocks.length > 1).map((u) => ({ title: u.title, text: u.blocks.join("\n\n") }));
}
function toRoman(n) {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] || String(n);
}

// ---------------------------------------------------------------- Gibbon
function stripFootnotes(text) {
  // A footnote is "[Footnote …]" running to the first "]" that ends a paragraph.
  // (Bracket counting is unsafe: a few notes have unbalanced brackets.)
  let out = "", i = 0;
  const end = /\]\s*\n\s*\n/g;
  while (i < text.length) {
    const at = text.indexOf("[Footnote", i);
    if (at < 0) { out += text.slice(i); break; }
    out += text.slice(i, at);
    end.lastIndex = at;
    const m = end.exec(text);
    i = m ? m.index + 1 : text.length;
  }
  return out.replace(/ ?\[\d+[a-z]*\]/g, "").replace(/ ?\[See [^\]]*\]/g, "");
}

function buildGibbon() {
  const chapters = new Map();
  for (let v = 1; v <= 6; v++) {
    const lines = stripFootnotes(body(read(`gibbon${v}.txt`))).split("\n");
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      // headings sometimes wrap: "Chapter XVI: Conduct Towards The Christians, From Nero To" / "Constantine.--Part I."
      if (/^Chapter [IVXLC]+:/.test(l) && !/Part [IVX]+\.?\s*$/.test(l) && lines[i + 1] && lines[i + 1].trim()) {
        l = l + " " + lines[++i].trim();
      }
      const m = l.match(/^Chapter ([IVXLC]+)[:.]\s*(.*?)\.?\s*(?:--|—|\.)?\s*Part ([IVX]+)\.?\s*$/i)
        || l.match(/^Chapter ([IVXLC]+)[:.]\s*(.*?)\.?\s*$/);
      if (m && l === l.trim()) {
        const n = roman(m[1].toUpperCase());
        const title = m[2].replace(/[.\-—\s]+$/, "").replace(/--$/, "");
        const partNo = m[3] ? roman(m[3].toUpperCase()) : 1;
        if (!chapters.has(n)) chapters.set(n, { n, title, volume: v, parts: [] });
        cur = { n: partNo, paras: [] };
        chapters.get(n).parts.push(cur);
        continue;
      }
      if (!cur) continue;
      cur.paras.push(l);
    }
  }
  const parts = [...chapters.values()].sort((a, b) => a.n - b.n).map((ch) => {
    const units = ch.parts.map((p) => {
      const blocks = [];
      let para = [];
      const flush = () => {
        if (!para.length) return;
        const t = para.join(" ").replace(/\s+/g, " ").replace(/--/g, "—").trim();
        if (t) blocks.push(t);
        para = [];
      };
      for (const l of p.paras) {
        if (!l.trim()) { flush(); continue; }
        if (/^\s{3,}\S/.test(l)) { // indented sub-headings ("The Extent And Military Force…")
          flush();
          const h = l.trim();
          const prev = blocks[blocks.length - 1];
          if (prev && prev.startsWith("[")) blocks[blocks.length - 1] = prev.slice(0, -1) + " " + h + "]";
          else blocks.push(`[${h}]`);
          continue;
        }
        if (/^(Introduction\.?|END OF VOL.*|.*\bVOLUME\b.*)$/i.test(l.trim()) && para.length === 0) continue;
        para.push(l.trim());
      }
      flush();
      const title = `Chapter ${toRomanBig(ch.n)}, Part ${p.n}`;
      return { title, text: [`# Chapter ${toRomanBig(ch.n)} · ${ch.title}${ch.parts.length > 1 ? ` · Part ${p.n}` : ""}`, ...blocks].join("\n\n") };
    });
    return { id: `chapter-${String(ch.n).padStart(2, "0")}`, title: `${toRomanBig(ch.n)}. ${ch.title}`, units };
  });
  return writeText("gibbon", { title: "The History of the Decline and Fall of the Roman Empire", short: "Gibbon",
    author: "Edward Gibbon", kind: "prose" }, parts);
}
function toRomanBig(n) {
  const t = [[100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}

// ---------------------------------------------------------------- go
fs.mkdirSync(OUT, { recursive: true });
const texts = [buildKJV(), buildShakespeare(), buildGibbon()].map(({ group, ...t }) => t);
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ version: 1, texts }));
console.log("wrote", path.relative(process.cwd(), path.join(OUT, "manifest.json")));
