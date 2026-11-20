(() => {
  "use strict";

  const STORE = "copyist.v1.";
  const SIZES = [18, 20, 22, 24, 27, 30];
  const FONTS = [
    ["book", "Book"],
    ["roboto", "Roboto"],
    ["garamond", "Garamond"],
    ["typewriter", "Typewriter"],
  ];

  // ================================================================ storage
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(STORE + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* full, private mode */ }
  }

  // Your own texts live in IndexedDB (they can be megabytes).
  const db = (() => {
    let opening = null;
    function open() {
      if (!opening) opening = new Promise((resolve, reject) => {
        const req = indexedDB.open("copyist", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("texts", { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return opening;
    }
    function run(mode, fn) {
      return open().then((d) => new Promise((resolve, reject) => {
        const tx = d.transaction("texts", mode);
        const r = fn(tx.objectStore("texts"));
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
      }));
    }
    return {
      all: () => run("readonly", (s) => s.getAll()).catch(() => []),
      get: (id) => run("readonly", (s) => s.get(id)),
      put: (t) => run("readwrite", (s) => s.put(t)),
      del: (id) => run("readwrite", (s) => s.delete(id)),
    };
  })();

  // ================================================================ prefs
  const prefs = Object.assign({ stats: true, size: 22, font: "book" }, load("prefs", {}));
  function setPref(k, v) { prefs[k] = v; save("prefs", prefs); }

  function applyFont() {
    document.documentElement.dataset.font = prefs.font;
    document.querySelectorAll(".font-select").forEach((s) => { s.value = prefs.font; });
  }
  document.querySelectorAll(".font-select").forEach((sel) => {
    for (const [v, label] of FONTS) {
      const o = document.createElement("option");
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      setPref("font", sel.value);
      applyFont();
      if (reader.active) document.fonts.ready.then(() => reader.relayout());
      if (reader.active) input.focus();
    });
  });
  document.querySelectorAll(".stats-toggle").forEach((box) => {
    box.checked = prefs.stats;
    box.addEventListener("change", () => { setPref("stats", box.checked); renderStatsLines(); });
  });
  function applySize() {
    document.documentElement.style.setProperty("--size", prefs.size + "px");
  }

  // ================================================================ stats
  function dayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function countWord() {
    const days = load("days", {});
    const k = dayKey(new Date());
    days[k] = (days[k] || 0) + 1;
    save("days", days);
  }
  function statsText() {
    if (!prefs.stats) return "";
    const days = load("days", {});
    let active = 0;
    for (let k = 0; k < 7; k++) {
      const d = new Date(); d.setDate(d.getDate() - k);
      if (days[dayKey(d)]) active++;
    }
    const n = days[dayKey(new Date())] || 0;
    return `Today ${n.toLocaleString()} ${n === 1 ? "word" : "words"} · ${active} of the last 7 days`;
  }
  function renderStatsLines() {
    const t = statsText();
    $("library-stats").textContent = t;
    $("bar-stats").textContent = t;
  }

  // ================================================================ text model
  const MAP = {
    "‘": "'", "’": "'", "ʼ": "'", "`": "'",
    "“": '"', "”": '"',
    "—": "-", "–": "-", "‒": "-",
    "æ": "ae", "œ": "oe", "ß": "ss", "…": "..."
  };
  function units(ch) {
    let c = ch.toLowerCase();
    if (MAP[c]) return MAP[c].split("");
    c = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (MAP[c]) return MAP[c].split("");
    return c.split("");
  }
  function typedUnits(str) {
    const out = [];
    for (const ch of str) out.push(...units(ch));
    return out.filter((u, i) => !(u === "-" && out[i - 1] === "-"));
  }
  const isPunct = (ch) => /[\p{P}\p{S}]/u.test(ch);

  // Markup (see scripts/copyist-texts.mjs). Your own texts are "plain":
  // only "# " headings mean anything there.
  function parse(text, plain, numbered) {
    const blocks = [];
    for (const raw of text.replace(/\r/g, "").split(/\n\s*\n/)) {
      const block = raw.replace(/^\n+|\n+$/g, "");
      if (!block.trim()) continue;
      if (block.startsWith("# ")) { blocks.push({ type: "heading", text: block.slice(2).trim() }); continue; }
      const lines = block.split("\n");
      if (!plain) {
        if (/^\[[\s\S]*\]$/.test(block.trim())) { blocks.push({ type: "direction", text: block.trim().slice(1, -1) }); continue; }
        const sp = lines[0].match(/^@([^ ]+) (.*)$/);
        if (sp) { blocks.push({ type: "speech", speaker: sp[1], lines: [sp[2], ...lines.slice(1)] }); continue; }
        const vn = numbered && lines[0].match(/^(\d+)\s+(.*)$/);
        if (vn) { blocks.push({ type: "verse", n: vn[1], lines: [vn[2], ...lines.slice(1)] }); continue; }
      }
      blocks.push({ type: "para", lines });
    }
    return blocks;
  }

  // ================================================================ DOM helpers
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  const input = $("input");

  // ================================================================ catalogue
  let manifest = null;
  let ownTexts = [];
  async function loadCatalogue() {
    if (!manifest) {
      const r = await fetch("texts/manifest.json");
      manifest = await r.json();
    }
    ownTexts = (await db.all()).sort((a, b) => b.added - a.added);
  }
  function textMeta(id) {
    if (id.startsWith("own-")) {
      const t = ownTexts.find((x) => x.id === id);
      return t && { id: t.id, title: t.title, short: t.title, kind: "prose", own: true,
        parts: [{ id: "all", title: t.title, units: t.units.map((u) => ({ title: u.title, words: u.words })) }] };
    }
    return manifest.texts.find((t) => t.id === id);
  }
  const partCache = new Map();
  async function loadUnit(meta, p, u) {
    if (meta.own) {
      const t = await db.get(meta.id);
      return t.units[u].text;
    }
    const file = meta.parts[p].file;
    if (!partCache.has(file)) {
      partCache.set(file, fetch("texts/" + file).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
    }
    try {
      return (await partCache.get(file)).units[u].text;
    } catch (e) { partCache.delete(file); throw e; }
  }
  const unitKey = (id, p, u) => `u.${id}.${p}.${u}`;
  function nextUnit(meta, p, u) {
    if (u + 1 < meta.parts[p].units.length) return [p, u + 1];
    if (p + 1 < meta.parts.length) return [p + 1, 0];
    return null;
  }
  // "Act I, Scene 1" needs its play's name once it is shown away from the contents.
  function fullTitle(meta, p, u) {
    const part = meta.parts[p], t = part.units[u].title;
    return /^(Act |Prologue|Epilogue|Induction)/.test(t) ? `${part.title}, ${t}` : t;
  }
  function shortLabel(title) {
    let m = title.match(/Act ([IVX]+), Scene (\d+)/);
    if (m) return `${m[1]}.${m[2]}`;
    m = title.match(/Act ([IVX]+), Chorus/);
    if (m) return `${m[1]} Chorus`;
    m = title.match(/Induction, Scene (\d+)/);
    if (m) return `Ind. ${m[1]}`;
    m = title.match(/(\d+)(?!.*\d)/);
    if (m) return m[1];
    return title.replace(/^The /, "");
  }

  // ================================================================ views
  const views = { library: $("library"), contents: $("contents") };
  function show(view) {
    document.body.className = "view-" + view;
    views.library.hidden = view !== "library";
    views.contents.hidden = view !== "contents";
    $("viewport").hidden = $("bar").hidden = view !== "reader";
    $("hint").classList.add("gone");
    $("loading").hidden = true;
    if (view !== "reader") { reader.active = false; window.scrollTo(0, 0); }
  }

  async function route() {
    await loadCatalogue();
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    if (parts[0] === "t" && textMeta(parts[1])) return showContents(parts[1]);
    if (parts[0] === "r" && textMeta(parts[1])) return reader.open(parts[1], Number(parts[2]) || 0, Number(parts[3]) || 0);
    showLibrary();
  }
  window.addEventListener("hashchange", route);

  // ---------------- library
  function continueInfo(meta) {
    const last = load("last." + meta.id, null);
    if (!last || !meta.parts[last.p] || !meta.parts[last.p].units[last.u]) return null;
    return { ...last, title: fullTitle(meta, last.p, last.u) };
  }
  function bookRow(meta, extra) {
    const li = el("li", "book");
    const left = el("div");
    const title = el("a", "book-title", meta.title);
    title.href = "#/t/" + encodeURIComponent(meta.id);
    left.appendChild(title);
    const words = meta.words || meta.parts.reduce((a, p) => a + p.units.reduce((b, u) => b + (u.words || 0), 0), 0);
    const size = words < 1000 ? `${words.toLocaleString()} words` : `${Math.round(words / 1000).toLocaleString()}k words`;
    left.appendChild(el("div", "book-meta", [meta.author, size].filter(Boolean).join(" · ")));
    li.appendChild(left);
    const actions = el("div", "book-actions");
    const c = continueInfo(meta);
    const go = el("a", "continue", c ? `Continue · ${c.title}` : "Begin");
    go.href = c ? `#/r/${encodeURIComponent(meta.id)}/${c.p}/${c.u}` : `#/r/${encodeURIComponent(meta.id)}/0/0`;
    actions.appendChild(go);
    if (extra) actions.appendChild(extra);
    li.appendChild(actions);
    return li;
  }
  function showLibrary() {
    show("library");
    const list = $("book-list");
    list.innerHTML = "";
    for (const t of manifest.texts) list.appendChild(bookRow(t));
    const own = $("own-list");
    own.innerHTML = "";
    for (const t of ownTexts) {
      const del = el("button", "link-btn", "Remove");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm(`Remove “${t.title}” and your place in it?`)) return;
        await db.del(t.id);
        Object.keys(localStorage).filter((k) => k.startsWith(`${STORE}u.${t.id}.`) || k === `${STORE}last.${t.id}`).forEach((k) => localStorage.removeItem(k));
        route();
      });
      own.appendChild(bookRow(textMeta(t.id), del));
    }
    renderStatsLines();
    document.title = "Copyist — John Braybrooke";
  }

  // ---------------- contents
  function showContents(id) {
    show("contents");
    const meta = textMeta(id);
    $("contents-title").textContent = meta.title;
    const c = continueInfo(meta);
    $("contents-sub").innerHTML = "";
    if (meta.author) $("contents-sub").appendChild(document.createTextNode(meta.author + " · "));
    const go = el("a", "continue", c ? `Continue at ${c.title}` : "Begin at the beginning");
    go.href = c ? `#/r/${encodeURIComponent(id)}/${c.p}/${c.u}` : `#/r/${encodeURIComponent(id)}/0/0`;
    $("contents-sub").appendChild(go);

    const list = $("contents-list");
    list.innerHTML = "";
    meta.parts.forEach((part, p) => {
      const d = el("details", "part");
      if (meta.parts.length === 1 || (c ? c.p === p : p === 0)) d.open = true;
      const s = el("summary");
      s.appendChild(el("span", null, part.title));
      let done = 0;
      part.units.forEach((_, u) => { const st = load(unitKey(id, p, u), null); if (st && st.done) done++; });
      const total = part.units.length;
      s.appendChild(el("span", "part-count", done ? `${done} of ${total} done` : total === 1 ? "" : `${total}`));
      d.appendChild(s);
      const grid = el("div", "units");
      const labels = part.units.map((u) => shortLabel(u.title));
      if (labels.some((l) => l.length > 5)) grid.classList.add("wide");
      part.units.forEach((unit, u) => {
        const a = el("a", "unit", labels[u]);
        a.href = `#/r/${encodeURIComponent(id)}/${p}/${u}`;
        a.title = unit.title;
        const st = load(unitKey(id, p, u), null);
        if (st && st.done) a.classList.add("done");
        else if (st && (st.typed && st.typed.length)) a.classList.add("started");
        if (c && c.p === p && c.u === u) a.classList.add("here");
        grid.appendChild(a);
      });
      d.appendChild(grid);
      list.appendChild(d);
    });
    document.title = `${meta.short || meta.title} — Copyist`;
  }

  // ================================================================ adding your own text
  function cleanUpload(raw) {
    let t = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const start = t.search(/^\*\*\* ?START OF (THIS|THE) PROJECT GUTENBERG.*$/m);
    if (start >= 0) t = t.slice(t.indexOf("\n", start) + 1);
    const end = t.search(/^(\*\*\* ?END OF (THIS|THE) PROJECT GUTENBERG|End of (the )?Project Gutenberg)/m);
    if (end >= 0) t = t.slice(0, end);
    return t.replace(/_([^_\n]+)_/g, "$1");
  }
  function toUnits(text, title) {
    const blocks = text.split(/\n\s*\n/).map((b) => b.replace(/^\n+|\s+$/g, "")).filter((b) => b.trim());
    const out = [];
    let cur = null, words = 0;
    const startUnit = (name) => {
      cur = { title: name, blocks: [] };
      out.push(cur);
      words = 0;
    };
    const HEAD = /^(chapter|book|part|section|canto|letter|act|scene|stave)\b[\s\S]{0,80}$|^[IVXLC]+\.?$/i;
    for (const b of blocks) {
      const lines = b.split("\n").map((l) => l.trim());
      const one = lines.join(" ");
      if (lines.length <= 2 && one.length < 90 && (HEAD.test(one) || (one === one.toUpperCase() && /[A-Z]{3}/.test(one)))) {
        startUnit(one.replace(/\s+/g, " "));
        cur.blocks.push("# " + cur.title);
        continue;
      }
      if (!cur || words > 2500) {
        startUnit(cur ? `${title}, part ${out.length + 1}` : title);
        if (out.length > 1) cur.blocks.push(`# ${cur.title}`);
      }
      // Hard-wrapped prose is joined; short lines (verse) keep their breaks.
      const body = lines.length > 1 ? lines.slice(0, -1) : lines; // a paragraph's last line is short
      const avg = body.reduce((a, l) => a + l.length, 0) / body.length;
      const prose = lines.length === 1 || avg > 50;
      cur.blocks.push(prose ? one.replace(/\s+/g, " ") : lines.join("\n"));
      words += one.split(/\s+/).length;
    }
    const units = out.filter((u) => u.blocks.some((b) => !b.startsWith("# ")));
    // number repeated generic titles
    return units.map((u, i) => {
      const text = u.blocks.join("\n\n");
      const w = text.split("\n").filter((l) => !l.startsWith("# ")).join(" ").split(/\s+/).filter(Boolean).length;
      return { title: u.title || `${title} ${i + 1}`, text, words: w };
    });
  }
  function guessTitle(raw, fallback) {
    const m = raw.match(/^Title:\s*(.+)$/m);
    return (m ? m[1] : fallback).trim();
  }
  async function addText(raw, title) {
    const text = cleanUpload(raw);
    const units = toUnits(text, title);
    if (!units.length) throw new Error("There’s no text in that.");
    const id = "own-" + Date.now().toString(36);
    await db.put({ id, title, added: Date.now(), units });
    return { id, units };
  }
  $("add-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const raw = await f.text();
    $("add-title").value = guessTitle(raw, f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    $("add-paste").value = "";
    $("add-paste").placeholder = `${f.name} (${Math.round(f.size / 1024).toLocaleString()} KB) is ready. Add it, or paste something else instead.`;
    $("add-save").dataset.file = "1";
    $("add-save").fileText = raw;
  });
  $("add-save").addEventListener("click", async () => {
    const status = $("add-status");
    const raw = $("add-paste").value.trim() ? $("add-paste").value : $("add-save").fileText;
    const title = $("add-title").value.trim() || "Untitled";
    if (!raw || !raw.trim()) { status.textContent = "Choose a file or paste some text first."; return; }
    try {
      const { id, units } = await addText(raw, title);
      status.textContent = `Added “${title}”, ${units.length} ${units.length === 1 ? "section" : "sections"}.`;
      $("add-paste").value = ""; $("add-title").value = ""; $("add-file").value = "";
      $("add-save").fileText = null;
      $("add-paste").placeholder = "Paste the text here";
      $("add-text").open = false;
      await loadCatalogue();
      location.hash = "#/t/" + encodeURIComponent(id);
    } catch (err) {
      status.textContent = err.message || "That didn’t work. Is it a plain-text file?";
    }
  });

  // ================================================================ reader
  const reader = (() => {
    const pageEl = $("page"), caretEl = $("caret"), hintEl = $("hint"), noteEl = $("end-note");
    let meta = null, pos = null, words = [], state = null, lastTop = null, token = 0;
    const api = { active: false };

    function addLine(container, line) {
      // {inline} parts are shown but not typed
      const pieces = line.split(/(\{[^}]*\})/).filter((s) => s !== "");
      let first = true;
      for (const piece of pieces) {
        if (piece.startsWith("{") && piece.endsWith("}")) {
          container.appendChild(document.createTextNode(" "));
          container.appendChild(el("span", "skip", piece.slice(1, -1)));
          continue;
        }
        piece.trim().split(/\s+/).filter(Boolean).forEach((w) => {
          if (!first) container.appendChild(document.createTextNode(" "));
          first = false;
          const span = el("span", "w");
          const chars = [], charEls = [];
          for (const ch of w) {
            const c = el("span", "c", ch);
            span.appendChild(c);
            charEls.push(c);
            chars.push({ ch, u: units(ch), punct: isPunct(ch) });
          }
          container.appendChild(span);
          words.push({ chars, el: span, charEls });
        });
        first = false;
      }
    }

    function render(markup) {
      caretEl.remove();
      noteEl.remove();
      pageEl.innerHTML = "";
      words = [];
      let firstProse = true;
      for (const b of parse(markup, meta.own, meta.kind === "verse")) {
        if (b.type === "heading") { pageEl.appendChild(el("h2", "heading", b.text)); continue; }
        if (b.type === "direction") { pageEl.appendChild(el("p", "direction", b.text)); continue; }
        let host, p;
        if (b.type === "speech") {
          host = el("div", "speech");
          host.appendChild(el("div", "speaker", b.speaker.replace(/ /g, " ")));
          p = el("p");
          host.appendChild(p);
        } else {
          const prose = b.type === "para" && meta.kind === "prose" && b.lines.length === 1;
          p = el("p", b.type === "verse" ? "verse" : prose ? "prose" + (firstProse ? " first" : "") : "");
          if (prose) firstProse = false;
          if (b.type === "verse") p.appendChild(el("span", "vn", b.n));
          host = p;
        }
        b.lines.forEach((line, i) => {
          if (i) p.appendChild(document.createElement("br"));
          addLine(p, line);
        });
        pageEl.appendChild(host);
      }
      pageEl.appendChild(noteEl);
      pageEl.appendChild(caretEl);
    }

    // ---------- judging
    function flatten(word) {
      const flat = [];
      word.chars.forEach((c, ci) => c.u.forEach((u) => flat.push({ u, ci })));
      return flat;
    }
    function judgeCommitted(word, typed) {
      const O = flatten(word), T = typedUnits(typed);
      const n = O.length, m = T.length;
      const d = Array.from({ length: n + 1 }, (_, i) => {
        const row = new Array(m + 1).fill(0); row[0] = i; return row;
      });
      for (let j = 0; j <= m; j++) d[0][j] = j;
      for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (O[i - 1].u === T[j - 1] ? 0 : 1));
      }
      const okUnit = new Array(n).fill(false);
      let extraPunct = false, i = n, j = m;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (O[i - 1].u === T[j - 1] ? 0 : 1)) {
          okUnit[i - 1] = O[i - 1].u === T[j - 1]; i--; j--;
        } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
          i--;
        } else {
          if (isPunct(T[j - 1])) extraPunct = true;
          j--;
        }
      }
      const ok = word.chars.map(() => true);
      O.forEach((o, k) => { if (!okUnit[k]) ok[o.ci] = false; });
      return { ok, extraPunct };
    }
    function judgeLive(word, typed) {
      const T = typedUnits(typed);
      let p = 0, reached = 0;
      const ok = [];
      for (const c of word.chars) {
        if (p + c.u.length > T.length) break;
        ok.push(c.u.every((u, k) => T[p + k] === u));
        p += c.u.length;
        reached++;
      }
      return { ok, reached };
    }

    function paint(i) {
      const w = words[i];
      if (!w) return;
      let done = 0, ok = [], extra = false;
      if (state.done) {
        done = w.chars.length; ok = w.chars.map(() => true);
      } else if (i < state.typed.length) {
        const r = judgeCommitted(w, state.typed[i]);
        ok = r.ok; extra = r.extraPunct; done = w.chars.length;
      } else if (i === state.typed.length && state.buf) {
        const r = judgeLive(w, state.buf);
        ok = r.ok; done = r.reached;
      }
      w.el.classList.toggle("px", extra);
      w.charEls.forEach((c, k) => {
        const isDone = k < done, bad = isDone && !ok[k];
        c.classList.toggle("d", isDone);
        c.classList.toggle("wr", bad && !w.chars[k].punct);
        c.classList.toggle("pm", bad && w.chars[k].punct);
      });
    }

    // ---------- caret + typewriter scroll
    const finished = () => state.done || state.typed.length >= words.length;
    function place(instant) {
      const note = noteEl;
      if (finished()) {
        caretEl.style.display = "none";
        showEnd(note);
        scrollTo(note.offsetTop, instant);
        return;
      }
      note.hidden = true;
      caretEl.style.display = "";
      const w = words[state.typed.length];
      const reached = state.buf ? judgeLive(w, state.buf).reached : 0;
      const pageRect = pageEl.getBoundingClientRect();
      const atEnd = reached >= w.charEls.length;
      const rect = w.charEls[atEnd ? w.charEls.length - 1 : reached].getBoundingClientRect();
      const top = rect.top - pageRect.top;
      caretEl.style.left = ((atEnd ? rect.right + 1 : rect.left) - pageRect.left) + "px";
      caretEl.style.width = (atEnd ? Math.max(rect.width * 0.7, 6) : Math.max(rect.width, 6)) + "px";
      caretEl.style.top = (top + rect.height - 4) + "px";
      scrollTo(top, instant);
    }
    function scrollTo(top, instant) {
      if (lastTop === top && !instant) return;
      lastTop = top;
      const shift = Math.round(window.innerHeight * 0.46) - top;
      if (instant) pageEl.style.transition = "none";
      pageEl.style.transform = `translateY(${shift}px)`;
      if (instant) { void pageEl.offsetHeight; pageEl.style.transition = ""; }
    }

    function tally() {
      let misses = 0;
      words.forEach((w, i) => {
        const r = judgeCommitted(w, state.typed[i] || "");
        r.ok.forEach((good, k) => { if (!good && w.chars[k].punct) misses++; });
        if (r.extraPunct) misses++;
      });
      return misses;
    }
    function showEnd(note) {
      const unit = { title: fullTitle(meta, pos.p, pos.u) };
      note.innerHTML = "";
      const misses = state.done ? state.misses : tally();
      const when = state.done && state.at && dayKey(new Date(state.at)) !== dayKey(new Date())
        ? ` on ${new Date(state.at).toLocaleDateString(undefined, { day: "numeric", month: "long" })}` : "";
      note.appendChild(el("div", null, `${unit.title}, done${when}. ${words.length.toLocaleString()} words, ${misses} punctuation ${misses === 1 ? "mark" : "marks"} missed.`));
      const row = el("div", "row");
      const nx = nextUnit(meta, pos.p, pos.u);
      if (nx) {
        const b = el("button", "btn primary", `Next: ${fullTitle(meta, nx[0], nx[1])}`);
        b.type = "button";
        b.addEventListener("click", goNext);
        row.appendChild(b);
      }
      const again = el("button", "btn", "Type it again");
      again.type = "button";
      again.addEventListener("click", restart);
      row.appendChild(again);
      note.appendChild(row);
      if (nx) note.appendChild(el("div", "key", "or press Enter"));
      note.hidden = false;
    }

    // ---------- editing
    function persist() {
      save(unitKey(meta.id, pos.p, pos.u), state);
    }
    function complete() {
      // Keep only a summary of finished units, so storage stays small.
      state = { done: true, misses: tally(), words: words.length, at: Date.now(), high: words.length };
      persist();
    }
    function commit() {
      const i = state.typed.length;
      if (i >= words.length) return;
      state.typed.push(state.buf);
      state.buf = "";
      if (i >= state.high) { state.high = i + 1; countWord(); }
      paint(i);
      paint(i + 1);
      if (state.typed.length >= words.length) complete();
      persist();
      place();
    }
    function typeChar(ch) {
      if (finished()) { if (/\s/.test(ch) && ch !== " ") goNext(); return; }
      if (/\s/.test(ch)) { if (state.buf) commit(); return; }
      state.buf += ch;
      hintEl.classList.add("gone");
      paint(state.typed.length);
      persist();
      place();
    }
    function backspace(wholeWord) {
      if (state.done) return;
      if (state.buf) {
        state.buf = wholeWord ? "" : [...state.buf].slice(0, -1).join("");
      } else if (state.typed.length) {
        const i = state.typed.length - 1;
        state.buf = wholeWord ? "" : state.typed.pop();
        if (wholeWord) state.typed.pop();
        paint(i);
        paint(i + 1);
      }
      paint(state.typed.length);
      persist();
      place();
    }
    function skip() {
      if (!finished()) commit();
    }
    function restart() {
      state = { typed: [], buf: "", high: 0 };
      persist();
      words.forEach((_, i) => paint(i));
      place(true);
      input.focus();
    }
    function goNext() {
      const nx = nextUnit(meta, pos.p, pos.u);
      if (nx) location.hash = `#/r/${encodeURIComponent(meta.id)}/${nx[0]}/${nx[1]}`;
    }

    // ---------- open
    api.open = async (id, p, u) => {
      const my = ++token;
      meta = textMeta(id);
      if (!meta.parts[p] || !meta.parts[p].units[u]) { p = 0; u = 0; }
      pos = { p, u };
      show("reader");
      api.active = true;
      $("loading").hidden = false;
      let markup;
      try { markup = await loadUnit(meta, p, u); }
      catch {
        $("loading").textContent = "Couldn’t open that. Check the connection and try again.";
        return;
      }
      if (my !== token) return;
      $("loading").hidden = true;
      save("last." + id, { p, u });
      state = Object.assign({ typed: [], buf: "", high: 0 }, load(unitKey(id, p, u), {}));
      const unit = { title: fullTitle(meta, p, u) };
      $("bar-back").href = "#/t/" + encodeURIComponent(id);
      $("bar-where").innerHTML = "";
      const back = el("a", null, meta.short || meta.title);
      back.href = "#/t/" + encodeURIComponent(id);
      $("bar-where").append(back, document.createTextNode(` · ${unit.title}`));
      document.title = `${unit.title} — Copyist`;
      renderStatsLines();
      lastTop = null;
      render(markup);
      words.forEach((_, i) => paint(i));
      place(true);
      const fresh = !state.done && !state.typed.length && !state.buf;
      hintEl.classList.toggle("gone", !fresh);
      document.body.classList.toggle("show-bar", fresh && !load("seen-bar", false));
      save("seen-bar", true);
      input.focus();
      if (document.fonts) document.fonts.ready.then(() => { if (my === token) api.relayout(); });
    };
    api.relayout = () => { lastTop = null; place(true); };
    api.typeChar = typeChar;
    api.backspace = backspace;
    api.skip = skip;
    api.restart = () => {
      const unit = meta.parts[pos.p].units[pos.u];
      if (confirm(`Start ${unit.title} again from the beginning?`)) restart();
    };
    api.isFinished = () => finished();
    api.goNext = goNext;
    return api;
  })();

  // ================================================================ input
  let typing = false;
  function setTyping(on) {
    if (on === typing) return;
    typing = on;
    document.body.classList.toggle("typing", on);
    if (on) document.body.classList.remove("show-bar");
  }
  function showBar() {
    renderStatsLines();
    document.body.classList.add("show-bar");
  }

  input.addEventListener("keydown", (e) => {
    if (!reader.active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (document.body.classList.contains("show-bar")) document.body.classList.remove("show-bar");
      else { setTyping(false); showBar(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key !== "Backspace") return;
    if (e.key === "Backspace") { e.preventDefault(); setTyping(true); reader.backspace(e.altKey || e.ctrlKey); return; }
    if (e.key === "Tab") { e.preventDefault(); setTyping(true); reader.skip(); return; }
    if (e.key === "Enter") {
      e.preventDefault(); setTyping(true);
      if (reader.isFinished()) reader.goNext(); else reader.typeChar(" ");
    }
  });
  let composing = false;
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; flush(); });
  input.addEventListener("input", () => { if (!composing) flush(); });
  function flush() {
    const v = input.value;
    input.value = "";
    if (!v || !reader.active) return;
    setTyping(true);
    for (const ch of v) reader.typeChar(ch);
  }

  let lastMouse = null;
  document.addEventListener("mousemove", (e) => {
    const here = e.clientX + "," + e.clientY;
    if (here === lastMouse) return;
    lastMouse = here;
    setTyping(false);
    if (reader.active && e.clientY < 90) showBar();
  });
  document.addEventListener("mousedown", (e) => {
    if (!reader.active) return;
    if (!e.target.closest(".bar") && !e.target.closest("button") && !e.target.closest("a")) {
      document.body.classList.remove("show-bar");
      setTimeout(() => input.focus(), 0);
    }
  });
  window.addEventListener("focus", () => { if (reader.active) input.focus(); });
  window.addEventListener("resize", () => { if (reader.active) reader.relayout(); });

  function nudgeSize(dir) {
    const i = SIZES.indexOf(prefs.size);
    setPref("size", SIZES[Math.max(0, Math.min(SIZES.length - 1, (i < 0 ? 2 : i) + dir))]);
    applySize();
    reader.relayout();
  }
  $("smaller").addEventListener("click", () => { nudgeSize(-1); input.focus(); });
  $("larger").addEventListener("click", () => { nudgeSize(1); input.focus(); });
  $("restart").addEventListener("click", () => { reader.restart(); });

  // ================================================================ go
  applyFont();
  applySize();
  route().catch(() => {
    document.body.innerHTML = '<p style="font-family: sans-serif; padding: 2rem">Copyist couldn’t load its library. Check the connection and reload.</p>';
  });
})();
