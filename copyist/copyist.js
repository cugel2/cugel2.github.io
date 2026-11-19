(() => {
  "use strict";

  const STORE = "copyist.v1.";
  const SIZES = [18, 20, 22, 24, 27, 30];

  // ---------- storage (never trusted to exist) ----------
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(STORE + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  }

  // ---------- normalisation ----------
  // Each character becomes one or more comparison units. Case, accents,
  // curly vs straight quotes and dash styles never count as mistakes.
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
    // "--" typed for a dash counts as one dash
    return out.filter((u, i) => !(u === "-" && out[i - 1] === "-"));
  }
  const isPunct = (ch) => /[\p{P}\p{S}]/u.test(ch);

  // ---------- parsing the small markup ----------
  function parse(text) {
    const blocks = [];
    for (const raw of text.replace(/\r/g, "").split(/\n\s*\n/)) {
      const block = raw.replace(/^\n+|\n+$/g, "");
      if (!block.trim()) continue;
      if (block.startsWith("# ")) { blocks.push({ type: "heading", text: block.slice(2).trim() }); continue; }
      if (/^\[[\s\S]*\]$/.test(block.trim())) { blocks.push({ type: "direction", text: block.trim().slice(1, -1) }); continue; }
      const lines = block.split("\n");
      const sp = lines[0].match(/^@(\S+\.?)\s+(.*)$/);
      if (sp) { blocks.push({ type: "speech", speaker: sp[1], lines: [sp[2], ...lines.slice(1)] }); continue; }
      const vn = lines[0].match(/^(\d+)\s+(.*)$/);
      if (vn) { blocks.push({ type: "verse", n: vn[1], lines: [vn[2], ...lines.slice(1)] }); continue; }
      blocks.push({ type: "para", lines });
    }
    return blocks;
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const pageEl = $("page"), caretEl = $("caret"), input = $("input"), viewport = $("viewport");
  const hintEl = $("hint"), statsEl = $("stats"), selectEl = $("text-select");

  let text = null;      // current sample
  let words = [];       // { chars:[{ch,u,punct}], el, charEls }
  let state = null;     // { typed:[], buf:"", high:0 }
  let prefs = Object.assign({ stats: true, size: 22, text: null }, load("prefs", {}));

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function addLine(container, line) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    parts.forEach((w, k) => {
      if (k) container.appendChild(document.createTextNode(" "));
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
  }

  function render() {
    pageEl.innerHTML = "";
    words = [];
    const blocks = parse(text.text);
    let paraCount = 0;
    for (const b of blocks) {
      if (b.type === "heading") { pageEl.appendChild(el("h2", "heading", b.text)); continue; }
      if (b.type === "direction") { pageEl.appendChild(el("p", "direction", b.text)); continue; }
      let host, p;
      if (b.type === "speech") {
        host = el("div", "speech");
        host.appendChild(el("div", "speaker", b.speaker));
        p = el("p");
        host.appendChild(p);
      } else {
        p = el("p", b.type === "verse" ? "verse" : (text.kind === "prose" ? "prose" : ""));
        if (b.type === "verse") p.appendChild(el("span", "vn", b.n));
        if (text.kind === "prose" && paraCount++ === 0) p.style.textIndent = "0";
        host = p;
      }
      b.lines.forEach((line, i) => {
        if (i) p.appendChild(document.createElement("br"));
        addLine(p, line);
      });
      pageEl.appendChild(host);
    }
    const end = el("div", "end-note");
    end.id = "end-note";
    end.hidden = true;
    pageEl.appendChild(end);
    pageEl.appendChild(caretEl);
    words.forEach((_, i) => paint(i));
    place(true);
  }

  // ---------- comparing ----------
  function flatten(word) {
    const flat = [];
    word.chars.forEach((c, ci) => c.u.forEach((u) => flat.push({ u, ci })));
    return flat;
  }

  // Committed word: align typed against the original (edit distance), so a
  // dropped or doubled letter only marks that letter, never the rest.
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

  // Word being typed: plain left-to-right comparison, so the letters you
  // have reached darken as you go.
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
    let done = 0, ok = [], extra = false;
    if (i < state.typed.length) {
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

  // ---------- caret + typewriter scroll ----------
  let lastTop = null;
  function place(instant) {
    const i = state.typed.length;
    const finished = i >= words.length;
    const note = $("end-note");
    if (finished) {
      caretEl.style.display = "none";
      showEnd(note);
      scrollTo(note.offsetTop, instant);
      return;
    }
    note.hidden = true;
    caretEl.style.display = "";
    const w = words[i];
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

  function showEnd(note) {
    let misses = 0, slips = 0;
    words.forEach((w, i) => {
      const r = judgeCommitted(w, state.typed[i] || "");
      r.ok.forEach((good, k) => { if (!good) (w.chars[k].punct ? misses++ : slips++); });
      if (r.extraPunct) misses++;
    });
    note.innerHTML = "";
    note.appendChild(el("div", null, `${text.title} — done. ${words.length.toLocaleString()} words, ${misses} punctuation ${misses === 1 ? "mark" : "marks"} missed.`));
    const again = el("button", null, "Start over");
    again.type = "button";
    again.addEventListener("click", restart);
    note.appendChild(again);
    note.hidden = false;
  }

  // ---------- stats ----------
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function countWord() {
    const days = load("days", {});
    days[today()] = (days[today()] || 0) + 1;
    save("days", days);
  }
  function renderStats() {
    $("toggle-stats").textContent = prefs.stats ? "Hide stats" : "Show stats";
    if (!prefs.stats) { statsEl.textContent = ""; return; }
    const days = load("days", {});
    let active = 0;
    for (let k = 0; k < 7; k++) {
      const d = new Date(); d.setDate(d.getDate() - k);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (days[key]) active++;
    }
    const n = days[today()] || 0;
    statsEl.textContent = `Today ${n.toLocaleString()} ${n === 1 ? "word" : "words"} · ${active} of the last 7 days`;
  }

  // ---------- editing ----------
  function persist() { save("pos." + text.id, state); }

  function commit() {
    const i = state.typed.length;
    if (i >= words.length) return;
    state.typed.push(state.buf);
    state.buf = "";
    if (i >= state.high) { state.high = i + 1; countWord(); }
    paint(i);
    if (i + 1 < words.length) paint(i + 1);
    persist();
    place();
  }

  function typeChar(ch) {
    if (state.typed.length >= words.length) return;
    if (/\s/.test(ch)) { if (state.buf) commit(); return; }
    state.buf += ch;
    hintEl.classList.add("gone");
    paint(state.typed.length);
    persist();
    place();
  }

  function backspace(wholeWord) {
    if (state.buf) {
      state.buf = wholeWord ? "" : [...state.buf].slice(0, -1).join("");
    } else if (state.typed.length) {
      const i = state.typed.length - 1;
      state.buf = wholeWord ? "" : state.typed.pop();
      if (wholeWord) state.typed.pop();
      paint(i);
      if (i + 1 < words.length) paint(i + 1);
    }
    paint(state.typed.length);
    persist();
    place();
  }

  function skip() {
    if (state.typed.length >= words.length) return;
    commit();
  }

  function restart() {
    state = { typed: [], buf: "", high: 0 };
    persist();
    words.forEach((_, i) => paint(i));
    place(true);
    input.focus();
  }

  // ---------- typing mode / bar ----------
  let typing = false;
  function setTyping(on) {
    if (on === typing) return;
    typing = on;
    document.body.classList.toggle("typing", on);
    if (on) { document.body.classList.remove("show-bar"); hintEl.classList.add("gone"); }
  }
  function showBar() {
    renderStats();
    document.body.classList.add("show-bar");
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (document.body.classList.contains("show-bar")) document.body.classList.remove("show-bar");
      else { setTyping(false); showBar(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key !== "Backspace") return;
    if (e.key === "Backspace") { e.preventDefault(); setTyping(true); backspace(e.altKey || e.ctrlKey); return; }
    if (e.key === "Tab") { e.preventDefault(); setTyping(true); skip(); return; }
    if (e.key === "Enter") { e.preventDefault(); setTyping(true); typeChar(" "); return; }
  });

  let composing = false;
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; flush(); });
  input.addEventListener("input", () => { if (!composing) flush(); });
  function flush() {
    const v = input.value;
    input.value = "";
    if (!v) return;
    setTyping(true);
    for (const ch of v) typeChar(ch);
  }

  let lastMouse = null;
  document.addEventListener("mousemove", (e) => {
    const here = e.clientX + "," + e.clientY;
    if (here === lastMouse) return;
    lastMouse = here;
    setTyping(false);
    if (e.clientY < 90) showBar();
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest(".bar") && !e.target.closest("button")) {
      document.body.classList.remove("show-bar");
      setTimeout(() => input.focus(), 0);
    }
  });
  window.addEventListener("focus", () => input.focus());
  window.addEventListener("resize", () => { lastTop = null; place(true); });

  // ---------- bar controls ----------
  function applySize() {
    document.documentElement.style.setProperty("--size", prefs.size + "px");
    lastTop = null;
    if (text) place(true);
  }
  function nudgeSize(dir) {
    const i = SIZES.indexOf(prefs.size);
    prefs.size = SIZES[Math.max(0, Math.min(SIZES.length - 1, (i < 0 ? 2 : i) + dir))];
    save("prefs", prefs);
    applySize();
  }
  $("smaller").addEventListener("click", () => { nudgeSize(-1); input.focus(); });
  $("larger").addEventListener("click", () => { nudgeSize(1); input.focus(); });
  $("toggle-stats").addEventListener("click", () => { prefs.stats = !prefs.stats; save("prefs", prefs); renderStats(); input.focus(); });
  $("restart").addEventListener("click", () => { if (confirm(`Start ${text.title} again from the beginning?`)) restart(); });

  const samples = window.COPYIST_SAMPLES;
  for (const s of samples) {
    const o = el("option", null, `${s.source} — ${s.title}`);
    o.value = s.id;
    selectEl.appendChild(o);
  }
  selectEl.addEventListener("change", () => { open(selectEl.value); input.focus(); });

  function open(id) {
    text = samples.find((s) => s.id === id) || samples[0];
    prefs.text = text.id;
    save("prefs", prefs);
    selectEl.value = text.id;
    state = Object.assign({ typed: [], buf: "", high: 0 }, load("pos." + text.id, {}));
    lastTop = null;
    render();
    const started = state.typed.length || state.buf;
    hintEl.classList.toggle("gone", !!started);
  }

  applySize();
  open(prefs.text);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { lastTop = null; place(true); });
  input.focus();
})();
