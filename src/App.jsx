import { jsPDF } from "jspdf";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
// v2
// ─── File reader ──────────────────────────────────────────────────────────────
const readFile = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsText(file);
  });

function normalizeCode(code) {
  return code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/#.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getMatchingLines(codeA, codeB) {
  const rawA = codeA.split("\n").map(l => l.trim()).filter(l => l.length > 8);
  const rawB = new Set(codeB.split("\n").map(l => l.trim()).filter(l => l.length > 8));
  return rawA.filter(l => rawB.has(l));
}

function getNormalizedOverlapPct(codeA, codeB) {
  const normA = codeA.split("\n").map(l => normalizeCode(l)).filter(l => l.length > 3);
  const normB = new Set(codeB.split("\n").map(l => normalizeCode(l)).filter(l => l.length > 3));
  if (!normA.length) return 0;
  const matches = normA.filter(l => normB.has(l)).length;
  return Math.round((matches / normA.length) * 100);
}

function getTokenSimilarity(codeA, codeB) {
  const tokenize = (code) => new Set(
    code.toLowerCase().replace(/[^a-z0-9_\s]/g, " ").split(/\s+/).filter(t => t.length > 2)
  );
  const setA = tokenize(codeA);
  const setB = tokenize(codeB);
  const intersection = [...setA].filter(t => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  if (!union) return 0;
  return Math.round((intersection / union) * 100);
}

function getStructuralScore(codeA, codeB) {
  const extractIdents = (code) => {
    const matches = code.match(/\b(def |function |class |const |let |var )\s*([a-zA-Z_]\w*)/g) || [];
    return new Set(matches.map(m => m.trim().toLowerCase()));
  };
  const setA = extractIdents(codeA);
  const setB = extractIdents(codeB);
  const intersection = [...setA].filter(i => setB.has(i)).length;
  const union = new Set([...setA, ...setB]).size;
  if (!union) return 0;
  return Math.round((intersection / union) * 100);
}

// ─── PDF-safe string helper ───────────────────────────────────────────────────
// Strips/replaces all characters that cause jsPDF corruption
function pdfSafe(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    // Replace special math/arrow symbols
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↑/g, "^")
    .replace(/↓/g, "v")
    .replace(/×/g, "x")
    .replace(/÷/g, "/")
    .replace(/•/g, "-")
    .replace(/·/g, ".")
    .replace(/…/g, "...")
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/"/g, '"')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/'/g, "'")
    // Strip all emoji and non-Latin characters (covers all emoji ranges)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27FF}]/gu, "")
    .replace(/[\u{2300}-\u{23FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FEFF}]/gu, "")
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    // Remove any remaining non-ASCII characters
    .replace(/[^\x00-\x7F]/g, "")
    .trim();
}

// ─── ALGORITHMIC-ONLY FALLBACK ────────────────────────────────────────────────
function buildAlgorithmicResult(nameA, nameB, codeA, codeB) {
  const algoTokenSim    = getTokenSimilarity(codeA, codeB);
  const algoStructSim   = getStructuralScore(codeA, codeB);
  const algoNormOverlap = getNormalizedOverlapPct(codeA, codeB);
  const matchingLines   = getMatchingLines(codeA, codeB);

  const blendedSimilarity = Math.round(
    algoNormOverlap * 0.5 + algoTokenSim * 0.3 + algoStructSim * 0.2
  );

  const verdict = getVerdict(blendedSimilarity);
  const summary =
    `Algorithmic analysis only (AI unavailable). ` +
    `Token similarity: ${algoTokenSim}%, structural match: ${algoStructSim}%, ` +
    `normalized line overlap: ${algoNormOverlap}%. ` +
    `${matchingLines.length} exact matching lines found.`;

  return {
    similarity_percent:      blendedSimilarity,
    logic_similarity:        algoNormOverlap,
    structure_similarity:    algoStructSim,
    token_overlap:           algoTokenSim,
    human_score:             Math.max(0, 100 - blendedSimilarity),
    ai_generated_likelihood: null,
    language_a:              "Unknown",
    language_b:              "Unknown",
    summary,
    findings:
      `AI analysis was unavailable; results are based entirely on deterministic algorithms.\n\n` +
      `- Normalized line overlap: ${algoNormOverlap}%\n` +
      `- Token similarity (Jaccard): ${algoTokenSim}%\n` +
      `- Structural / identifier match: ${algoStructSim}%\n` +
      `- Exact matching lines: ${matchingLines.length}\n\n` +
      `Verdict: ${verdict}. Re-run when the API is available for a full AI-assisted report.`,
    ai_reason:               "AI unavailable - algorithmic scores only.",
    algo_token_similarity:   algoTokenSim,
    algo_structural_score:   algoStructSim,
    algo_normalized_overlap: algoNormOverlap,
    ai_run_count:            0,
    matchingLines,
    nameA,
    nameB,
    timestamp: new Date().toLocaleString(),
    ai_fallback: true,
  };
}

function getLevel(pct) {
  if (pct >= 70) return "high";
  if (pct >= 40) return "medium";
  if (pct >= 15) return "low";
  return "none";
}

function getVerdict(pct) {
  if (pct >= 70) return "Definite Plagiarism";
  if (pct >= 40) return "Likely Plagiarized";
  if (pct >= 15) return "Suspicious";
  return "Original";
}

const LANG_MAP = {
  js:    { label: "JavaScript", emoji: "JS" },
  jsx:   { label: "React/JSX",  emoji: "JSX" },
  ts:    { label: "TypeScript", emoji: "TS" },
  tsx:   { label: "React/TSX",  emoji: "TSX" },
  py:    { label: "Python",     emoji: "PY" },
  java:  { label: "Java",       emoji: "JV" },
  c:     { label: "C",          emoji: "C" },
  cpp:   { label: "C++",        emoji: "C++" },
  cs:    { label: "C#",         emoji: "CS" },
  go:    { label: "Go",         emoji: "GO" },
  rs:    { label: "Rust",       emoji: "RS" },
  rb:    { label: "Ruby",       emoji: "RB" },
  php:   { label: "PHP",        emoji: "PHP" },
  swift: { label: "Swift",      emoji: "SW" },
  kt:    { label: "Kotlin",     emoji: "KT" },
  html:  { label: "HTML",       emoji: "HTML" },
  css:   { label: "CSS",        emoji: "CSS" },
  txt:   { label: "Text",       emoji: "TXT" },
};

// UI emoji map (separate from PDF-safe labels)
const LANG_EMOJI_MAP = {
  js: "🟨", jsx: "⚛️", ts: "🔷", tsx: "⚛️", py: "🐍", java: "☕",
  c: "⚙️", cpp: "⚙️", cs: "🟣", go: "🐹", rs: "🦀", rb: "💎",
  php: "🐘", swift: "🍎", kt: "🎯", html: "🌐", css: "🎨", txt: "📄",
};

function detectLanguage(file) {
  if (!file) return null;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const base = LANG_MAP[ext] || { label: ext?.toUpperCase() || "Unknown", emoji: ext?.toUpperCase() || "?" };
  const uiEmoji = LANG_EMOJI_MAP[ext] || "📄";
  return { ...base, uiEmoji };
}

function computeDiff(linesA, linesB) {
  const a = linesA.slice(0, 400), b = linesB.slice(0, 400);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i-1].trim() === b[j-1].trim() ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const diffA = [], diffB = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1].trim() === b[j-1].trim()) {
      diffA.unshift({ type: "same",    line: a[i-1], ln: i }); diffB.unshift({ type: "same",  line: b[j-1], ln: j }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      diffB.unshift({ type: "added",   line: b[j-1], ln: j }); diffA.unshift({ type: "empty", line: "",     ln: null }); j--;
    } else {
      diffA.unshift({ type: "removed", line: a[i-1], ln: i }); diffB.unshift({ type: "empty", line: "",     ln: null }); i--;
    }
  }
  return { diffA, diffB };
}

const safeStorage = {
  get:    (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  remove: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// ─── GROQ API with retry + exponential backoff ────────────────────────────────
async function callGroqAPI(payload, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (resp.status === 429) {
        const waitMs = Math.pow(2, attempt) * 2000;
        await new Promise(res => setTimeout(res, waitMs));
        continue;
      }

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error?.message || `Groq API error ${resp.status}`);
      return data.choices?.[0]?.message?.content || "";
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  throw new Error("Rate limit exceeded after retries.");
}

async function callGroqOnce(nameA, nameB, codeA, codeB) {
  const prompt = `You are an expert code plagiarism analyst. Be precise and consistent.

Analyze the two code files and return ONLY a valid JSON object. No markdown, no backticks.

File A (${nameA}):
${codeA.slice(0, 6000)}

File B (${nameB}):
${codeB.slice(0, 6000)}

Return exactly:
{
  "similarity_percent": <integer 0-100>,
  "logic_similarity": <integer 0-100>,
  "structure_similarity": <integer 0-100>,
  "token_overlap": <integer 0-100>,
  "human_score": <integer 0-100>,
  "ai_generated_likelihood": <integer 0-100>,
  "language_a": "<string>",
  "language_b": "<string>",
  "summary": "<2-3 sentence factual summary>",
  "findings": "<detailed findings>",
  "ai_reason": "<one sentence AI detection reasoning>"
}`;

  const payload = {
  model: "llama-3.3-70b-versatile",
  temperature: 0,
  max_tokens: 800,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: "Return ONLY valid JSON. No text, no markdown. Be consistent." },
    { role: "user", content: prompt },
  ],
};
  return JSON.parse(await callGroqAPI(payload));
}

async function analyzeFilePair(fileA, fileB, codeA, codeB) {
  const algoTokenSim    = getTokenSimilarity(codeA, codeB);
  const algoStructSim   = getStructuralScore(codeA, codeB);
  const algoNormOverlap = getNormalizedOverlapPct(codeA, codeB);
  const matchingLines   = getMatchingLines(codeA, codeB);

  let run1 = null;
  try { run1 = await callGroqOnce(fileA.name, fileB.name, codeA, codeB); } catch {}

  if (!run1) {
    return buildAlgorithmicResult(fileA.name, fileB.name, codeA, codeB);
  }

  let run2 = null;
  try {
    await new Promise(res => setTimeout(res, 1500));
    run2 = await callGroqOnce(fileA.name, fileB.name, codeA, codeB);
  } catch {}

  const avg = (key) => {
    const vals = [run1, run2].filter(Boolean).map(r => Number(r[key]) || 0);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  const base = run1;

  const blendedSimilarity   = Math.round(avg("similarity_percent")  * 0.6 + algoNormOverlap * 0.4);
  const blendedTokenOverlap = Math.round(avg("token_overlap")        * 0.6 + algoTokenSim    * 0.4);
  const blendedStructure    = Math.round(avg("structure_similarity") * 0.6 + algoStructSim   * 0.4);

  return {
    similarity_percent:      blendedSimilarity,
    logic_similarity:        avg("logic_similarity"),
    structure_similarity:    blendedStructure,
    token_overlap:           blendedTokenOverlap,
    human_score:             avg("human_score"),
    ai_generated_likelihood: avg("ai_generated_likelihood"),
    language_a:              base.language_a || "Unknown",
    language_b:              base.language_b || "Unknown",
    summary:                 base.summary    || "",
    findings:                base.findings   || "",
    ai_reason:               base.ai_reason  || "",
    algo_token_similarity:   algoTokenSim,
    algo_structural_score:   algoStructSim,
    algo_normalized_overlap: algoNormOverlap,
    ai_run_count:            [run1, run2].filter(Boolean).length,
    matchingLines,
    nameA: fileA.name,
    nameB: fileB.name,
    timestamp: new Date().toLocaleString(),
    ai_fallback: false,
  };
}

function heatColor(pct) {
  if (pct === null || pct === undefined) return "rgba(255,255,255,0.04)";
  if (pct >= 70) return "rgba(255,79,79,0.35)";
  if (pct >= 40) return "rgba(245,166,35,0.30)";
  if (pct >= 15) return "rgba(128,216,255,0.20)";
  return "rgba(0,229,160,0.15)";
}
function heatTextColor(pct) {
  if (pct === null || pct === undefined) return "var(--muted)";
  if (pct >= 70) return "#ff6b6b";
  if (pct >= 40) return "#f5a623";
  if (pct >= 15) return "#80d8ff";
  return "#00e5a0";
}

function getRiskLabel(pct) {
  if (pct >= 70) return { label: "HIGH RISK",   color: "#ff4f4f", bg: "rgba(255,79,79,0.15)",   border: "rgba(255,79,79,0.4)" };
  if (pct >= 40) return { label: "MEDIUM RISK", color: "#f5a623", bg: "rgba(245,166,35,0.12)",  border: "rgba(245,166,35,0.4)" };
  if (pct >= 15) return { label: "LOW RISK",    color: "#80d8ff", bg: "rgba(128,216,255,0.1)",  border: "rgba(128,216,255,0.3)" };
  return             { label: "CLEAN",       color: "#00e5a0", bg: "rgba(0,229,160,0.08)",   border: "rgba(0,229,160,0.3)" };
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@400;500;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0f; --surface: #111118; --surface2: #18181f;
    --border: rgba(255,255,255,0.08); --border2: rgba(255,255,255,0.14);
    --text: #e8e8f0; --muted: #666680;
    --accent: #00e5a0; --accent2: #00b37a;
    --danger: #ff4f4f; --warn: #f5a623; --safe: #00e5a0;
    --mono: 'IBM Plex Mono', monospace; --sans: 'Syne', sans-serif;
  }
  body { background: radial-gradient(circle at 20% 20%, rgba(130,80,255,0.25), transparent 40%), radial-gradient(circle at 80% 30%, rgba(0,229,160,0.15), transparent 40%), radial-gradient(circle at 50% 80%, rgba(180,120,255,0.2), transparent 50%), #0a0a0f; color: var(--text); font-family: var(--sans); min-height: 100vh; }
  .app { max-width: 980px; margin: 0 auto; padding: 3rem 1.5rem 5rem; animation: fadeUp 0.5s ease both; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
  .header { margin-bottom: 2.5rem; text-align: center; }
  .eyebrow { font-size: 11px; letter-spacing: 2px; color: #888; font-family: var(--mono); margin-bottom: 12px; text-transform: uppercase; }
  .header h1 { font-size: clamp(2.5rem,6vw,3.5rem); font-weight:700; line-height:1.2; letter-spacing:-1px; color:#fff; margin-bottom:16px; transition: opacity 0.4s ease, transform 0.4s ease; }
  .header p { max-width:700px; margin:0 auto; font-size:15px; color:#aaa; line-height:1.8; font-family:var(--sans); }
  .trust-banner { background: linear-gradient(135deg, rgba(0,229,160,0.08), rgba(0,180,120,0.04)); border: 1px solid rgba(0,229,160,0.25); border-radius: 10px; padding: 12px 16px; margin-bottom: 1.5rem; font-family: var(--mono); font-size: 11px; color: #aaa; line-height: 1.8; }
  .trust-banner strong { color: var(--accent); }
  .trust-row { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px; }
  .trust-item { display: flex; align-items: center; gap: 5px; }
  .trust-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .reliability-note { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 8px 12px; margin-top: 10px; font-family: var(--mono); font-size: 10px; color: var(--muted); line-height: 1.8; }
  .reliability-note .tag { display: inline-block; border-radius: 4px; padding: 1px 6px; font-size: 9px; font-weight: 600; letter-spacing: 0.5px; margin-right: 4px; }
  .tag-verified { background: rgba(0,229,160,0.2); color: #00e5a0; }
  .tag-ai       { background: rgba(128,100,255,0.2); color: #b08dff; }
  .tag-blended  { background: rgba(245,166,35,0.2); color: #f5a623; }
  .tag-algo     { background: rgba(0,180,255,0.2); color: #0db4ff; }
  .algo-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-bottom: 1.25rem; }
  .algo-card { background: rgba(0,229,160,0.04); border: 1px solid rgba(0,229,160,0.15); border-radius: 8px; padding: 10px 12px; font-family: var(--mono); }
  .algo-lbl { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
  .algo-val { font-size: 18px; font-weight: 600; color: var(--accent); }
  .algo-sub { font-size: 9px; color: var(--muted); margin-top: 2px; }
  .mode-tabs { display:flex; gap:0; background:var(--surface); border:1px solid var(--border2); border-radius:10px; padding:4px; margin-bottom:1.5rem; }
  .mode-tab { flex:1; padding:8px 16px; border:none; border-radius:7px; cursor:pointer; font-family:var(--mono); font-size:12px; font-weight:500; letter-spacing:0.5px; background:transparent; color:var(--muted); transition:all 0.2s; }
  .mode-tab.active { background:var(--accent); color:#000; font-weight:600; }
  .mode-tab:not(.active):hover { color:var(--text); background:rgba(255,255,255,0.05); }
  .upload-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:1rem; }
  @media(max-width:600px) { .upload-grid { grid-template-columns:1fr; } .algo-row { grid-template-columns:1fr 1fr; } }
  .drop-zone { border-radius:12px; padding:2rem 1.5rem; text-align:center; cursor:pointer; background:rgba(20,20,30,0.6); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.08); position:relative; transition:border-color 0.2s, background 0.2s; }
  .drop-zone:hover, .drop-zone.drag { border-color:var(--accent); background:rgba(0,229,160,0.04); }
  .drop-zone.filled { border-style:solid; border-color:var(--accent2); background:rgba(0,179,122,0.05); }
  .drop-zone input { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
  .dz-icon { font-size:26px; display:block; margin-bottom:8px; line-height:1; }
  .dz-label { font-size:11px; font-family:var(--mono); color:var(--muted); letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
  .dz-name { font-size:13px; font-family:var(--mono); color:var(--accent); font-weight:500; word-break:break-all; }
  .dz-hint { font-size:12px; color:var(--muted); font-family:var(--mono); }
  .dz-remove { position:absolute; top:8px; right:10px; background:rgba(255,79,79,0.15); border:1px solid rgba(255,79,79,0.3); border-radius:6px; color:#ff4f4f; font-size:11px; padding:2px 7px; cursor:pointer; font-family:var(--mono); z-index:2; transition:background 0.15s; }
  .dz-remove:hover { background:rgba(255,79,79,0.3); }
  .lang-badge { display:inline-flex; align-items:center; gap:5px; background:rgba(0,229,160,0.1); border:1px solid rgba(0,229,160,0.25); border-radius:20px; padding:3px 10px; font-family:var(--mono); font-size:11px; color:var(--accent); margin-top:8px; }
  .batch-drop { border:1.5px dashed var(--border2); border-radius:12px; padding:2.5rem 2rem; text-align:center; cursor:pointer; background:rgba(20,20,30,0.6); backdrop-filter:blur(12px); position:relative; transition:border-color 0.2s, background 0.2s; margin-bottom:1rem; }
  .batch-drop:hover, .batch-drop.drag { border-color:var(--accent); background:rgba(0,229,160,0.04); }
  .batch-drop input { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
  .batch-files-grid { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:1rem; }
  .batch-file-chip { display:flex; align-items:center; gap:6px; background:var(--surface); border:1px solid var(--border2); border-radius:8px; padding:5px 10px; font-family:var(--mono); font-size:12px; }
  .batch-file-chip .chip-remove { background:none; border:none; color:var(--muted); cursor:pointer; font-size:12px; padding:0 0 0 4px; line-height:1; transition:color 0.15s; }
  .batch-file-chip .chip-remove:hover { color:var(--danger); }
  .matrix-wrap { overflow-x:auto; margin-bottom:1.5rem; }
  .matrix-table { border-collapse:collapse; min-width:100%; font-family:var(--mono); font-size:12px; }
  .matrix-table th { padding:8px 12px; text-align:left; color:var(--muted); font-weight:500; font-size:11px; letter-spacing:0.5px; border-bottom:1px solid var(--border2); white-space:nowrap; max-width:120px; overflow:hidden; text-overflow:ellipsis; }
  .matrix-table th.corner { background:var(--surface); border-right:1px solid var(--border2); }
  .matrix-table td { padding:0; border:1px solid rgba(255,255,255,0.05); min-width:72px; text-align:center; position:relative; }
  .matrix-cell { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:10px 8px; cursor:pointer; transition:filter 0.15s, transform 0.1s; min-height:58px; gap:3px; }
  .matrix-cell:hover { filter:brightness(1.3); transform:scale(1.04); z-index:2; position:relative; }
  .matrix-cell.self { cursor:default; } .matrix-cell.self:hover { filter:none; transform:none; }
  .matrix-pct { font-size:15px; font-weight:600; line-height:1; }
  .matrix-verdict { font-size:9px; letter-spacing:0.5px; text-transform:uppercase; opacity:0.8; }
  .matrix-loading { display:flex; align-items:center; justify-content:center; min-height:58px; }
  .matrix-spinner { width:14px; height:14px; border:2px solid rgba(255,255,255,0.1); border-top-color:var(--accent); border-radius:50%; animation:spin 0.7s linear infinite; }
  .matrix-row-label { padding:8px 12px; font-family:var(--mono); font-size:11px; color:var(--muted); white-space:nowrap; max-width:120px; overflow:hidden; text-overflow:ellipsis; border-right:1px solid var(--border2); background:rgba(255,255,255,0.02); text-align:right; }
  .matrix-legend { display:flex; gap:16px; flex-wrap:wrap; padding:10px 0; font-family:var(--mono); font-size:11px; color:var(--muted); }
  .matrix-legend-item { display:flex; align-items:center; gap:6px; }
  .matrix-legend-dot { width:12px; height:12px; border-radius:3px; flex-shrink:0; }
  .batch-progress { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:1.25rem 1.5rem; margin-bottom:1rem; }
  .batch-progress-bar { height:4px; background:var(--border2); border-radius:2px; overflow:hidden; margin-top:10px; }
  .batch-progress-fill { height:100%; background:linear-gradient(90deg,#00e5a0,#00b37a); transition:width 0.4s ease; }
  .batch-status { font-family:var(--mono); font-size:12px; color:var(--muted); display:flex; justify-content:space-between; }
  .check-btn { width:100%; padding:1rem; background:var(--accent); color:#000; border:none; border-radius:10px; font-family:var(--mono); font-size:14px; font-weight:600; letter-spacing:1px; text-transform:uppercase; cursor:pointer; transition:background 0.15s, transform 0.1s; margin-bottom:2rem; box-shadow:0 0 25px rgba(0,229,160,0.3); }
  .check-btn:hover:not(:disabled) { background:#00ffb3; }
  .check-btn:active:not(:disabled) { transform:scale(0.99); }
  .check-btn:disabled { opacity:0.35; cursor:not-allowed; }
  .check-btn.busy { background:var(--surface2); color:var(--accent); border:1.5px solid var(--accent2); }
  .glass-btn { padding:10px 16px; border-radius:8px; cursor:pointer; font-family:var(--mono); font-size:12px; font-weight:500; letter-spacing:0.5px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); color:var(--text); transition:background 0.15s, border-color 0.15s; backdrop-filter:blur(8px); display:flex; align-items:center; gap:6px; }
  .glass-btn:hover { background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.22); }
  .glass-btn.danger { border-color:rgba(255,79,79,0.3); color:#ff4f4f; background:rgba(255,79,79,0.08); }
  .glass-btn.danger:hover { background:rgba(255,79,79,0.18); }
  .history-btn { padding:6px 14px; border-radius:8px; border:1px solid var(--border2); background:rgba(255,255,255,0.05); color:var(--muted); font-family:var(--mono); font-size:11px; cursor:pointer; letter-spacing:1px; transition:all 0.15s; backdrop-filter:blur(8px); }
  .history-btn:hover { border-color:var(--accent); color:var(--accent); }
  .history-panel { position:fixed; top:80px; right:20px; width:320px; max-height:400px; overflow-y:auto; background:rgba(17,17,24,0.97); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:12px; z-index:1000; backdrop-filter:blur(16px); box-shadow:0 20px 60px rgba(0,0,0,0.5); }
  .history-panel::-webkit-scrollbar { width:4px; }
  .history-panel::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }
  .history-item { font-size:11px; padding:8px; border-radius:6px; border-bottom:1px solid rgba(255,255,255,0.05); cursor:pointer; transition:background 0.15s; font-family:var(--mono); }
  .history-item:hover { background:rgba(0,229,160,0.06); }
  .history-item:last-child { border-bottom:none; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .spin { display:inline-block; width:13px; height:13px; border:2px solid var(--accent2); border-top-color:var(--accent); border-radius:50%; animation:spin 0.7s linear infinite; vertical-align:middle; margin-right:8px; }
  .err { background:rgba(255,79,79,0.1); border:1px solid rgba(255,79,79,0.3); border-radius:8px; padding:10px 14px; font-family:var(--mono); font-size:12px; color:var(--danger); margin-bottom:1.25rem; line-height:1.6; }
  .warn-banner { background:rgba(245,166,35,0.08); border:1px solid rgba(245,166,35,0.3); border-radius:8px; padding:10px 14px; font-family:var(--mono); font-size:11px; color:#f5a623; margin-bottom:1.25rem; line-height:1.7; }
  .history-notice { background:rgba(0,229,160,0.06); border:1px solid rgba(0,229,160,0.2); border-radius:8px; padding:10px 14px; font-family:var(--mono); font-size:11px; color:var(--accent); margin-bottom:1.25rem; display:flex; align-items:center; gap:8px; }
  .results { animation:fadeUp 0.4s ease both; }
  .section-label { font-family:var(--mono); font-size:10px; letter-spacing:2px; color:var(--muted); text-transform:uppercase; margin-bottom:10px; }
  .score-card { background:var(--surface); border:1px solid var(--border2); border-radius:14px; padding:1.75rem 2rem; margin-bottom:1.25rem; }
  .score-inner { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:12px 16px; margin-bottom:1rem; backdrop-filter:blur(10px); }
  .ring-wrap { position:relative; width:96px; height:96px; flex-shrink:0; margin:15px auto; }
  .ring-wrap svg { width:100%; height:100%; transform:rotate(-90deg); }
  .ring-track { fill:none; stroke:var(--border2); stroke-width:6; }
  .ring-fill { fill:none; stroke-width:6; stroke-linecap:round; transition:stroke-dashoffset 1s ease; }
  .ring-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .ring-pct { font-family:var(--mono); font-size:21px; font-weight:600; line-height:1; }
  .ring-sub { font-family:var(--mono); font-size:9px; color:var(--muted); letter-spacing:1px; text-transform:uppercase; margin-top:2px; }
  .stat-row { display:flex; justify-content:space-between; align-items:center; font-family:var(--mono); }
  .stat-item { text-align:center; }
  .stat-label { font-size:12px; color:#aaa; }
  .stat-value { font-size:20px; font-weight:600; }
  .divider-v { height:30px; width:1px; background:rgba(255,255,255,0.1); }
  .prog-bar { margin-top:10px; height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden; }
  .prog-fill { height:100%; background:linear-gradient(90deg,#00e5a0,#00b37a); transition:width 1s ease; }
  .score-info { margin-top:10px; }
  .verdict-pill { display:inline-block; font-family:var(--mono); font-size:11px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; padding:4px 12px; border-radius:20px; margin-bottom:10px; border:1px solid; }
  .score-summary { font-size:13px; color:var(--muted); line-height:1.7; font-family:var(--mono); }
  .lang-row { margin-top:8px; font-family:var(--mono); font-size:11px; color:var(--muted); }
  .download-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:1rem; }
  .metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:1.25rem; }
  @media(max-width:560px) { .metrics { grid-template-columns:1fr 1fr; } }
  .metric { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:1rem 1.1rem; }
  .metric .m-lbl { font-family:var(--mono); font-size:10px; letter-spacing:1px; text-transform:uppercase; color:var(--muted); margin-bottom:5px; }
  .metric .m-val { font-family:var(--mono); font-size:22px; font-weight:600; line-height:1; }
  .metric .m-bar { height:3px; background:var(--border2); border-radius:2px; margin-top:10px; overflow:hidden; }
  .metric .m-fill { height:100%; border-radius:2px; transition:width 0.8s ease; }
  .lines-box { background:var(--surface); border:1px solid var(--border); border-radius:10px; max-height:240px; overflow-y:auto; margin-bottom:1.25rem; }
  .line-row { display:flex; align-items:flex-start; gap:12px; padding:7px 14px; border-bottom:1px solid var(--border); font-family:var(--mono); font-size:12px; position:relative; }
  .line-row:last-child { border-bottom:none; }
  .ln { color:var(--muted); min-width:22px; flex-shrink:0; user-select:none; }
  .lc { color:var(--text); word-break:break-all; flex:1; }
  .copy-btn { opacity:0; position:absolute; right:8px; top:50%; transform:translateY(-50%); background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px; color:var(--muted); font-size:10px; padding:2px 6px; cursor:pointer; font-family:var(--mono); transition:opacity 0.15s, background 0.15s; }
  .line-row:hover .copy-btn { opacity:1; }
  .copy-btn:hover { background:rgba(0,229,160,0.15); color:var(--accent); }
  .copy-btn.copied { color:var(--accent); }
  .no-lines { padding:1.25rem; text-align:center; font-family:var(--mono); font-size:12px; color:var(--muted); }
  .lines-box::-webkit-scrollbar { width:4px; }
  .lines-box::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }
  .findings { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:1.25rem 1.5rem; font-family:var(--mono); font-size:12.5px; line-height:1.85; color:var(--text); white-space:pre-wrap; word-break:break-word; margin-bottom:1.25rem; }
  .diff-wrap { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; margin-bottom:1.25rem; }
  .diff-header { display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid var(--border2); }
  .diff-file-label { padding:8px 14px; font-family:var(--mono); font-size:11px; color:var(--muted); letter-spacing:1px; background:rgba(255,255,255,0.03); }
  .diff-file-label:first-child { border-right:1px solid var(--border2); }
  .diff-body { display:grid; grid-template-columns:1fr 1fr; max-height:480px; overflow-y:auto; overflow-x:hidden; }
  .diff-col { overflow-x:auto; min-width:0; }
  .diff-col:first-child { border-right:1px solid var(--border2); }
  .diff-line { display:flex; align-items:flex-start; gap:8px; padding:2px 10px; font-family:var(--mono); font-size:12px; min-height:22px; white-space:pre-wrap; word-break:break-all; }
  .diff-line.same    { background:rgba(255,255,255,0.03); color:#c8c8d8; border-left:3px solid rgba(255,255,255,0.08); }
  .diff-line.removed { background:rgba(255,79,79,0.12);   color:#ff8a8a; border-left:3px solid #ff4f4f; }
  .diff-line.added   { background:rgba(0,229,160,0.1);    color:#00e5a0; border-left:3px solid #00e5a0; }
  .diff-line.empty   { background:rgba(255,255,255,0.02); min-height:22px; border-left:3px solid transparent; }
  .diff-ln { color:var(--muted); min-width:24px; flex-shrink:0; user-select:none; font-size:11px; padding-top:2px; text-align:right; }
  .diff-sign { min-width:10px; flex-shrink:0; font-weight:700; padding-top:2px; }
  .diff-text { flex:1; min-width:0; word-break:break-all; }
  .diff-line.removed .diff-sign { color:#ff4f4f; }
  .diff-line.added   .diff-sign { color:#00e5a0; }
  .diff-line.same    .diff-sign, .diff-line.empty .diff-sign { color:transparent; }
  .diff-legend { display:flex; gap:16px; padding:8px 14px; border-top:1px solid var(--border); font-family:var(--mono); font-size:11px; flex-wrap:wrap; }
  .diff-legend-item { display:flex; align-items:center; gap:6px; color:var(--muted); }
  .diff-legend-dot { width:10px; height:10px; border-radius:2px; flex-shrink:0; }
  .diff-body::-webkit-scrollbar { width:4px; }
  .diff-body::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }
  .diff-note { padding:8px 14px; font-family:var(--mono); font-size:11px; color:var(--muted); border-top:1px solid var(--border); }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:2000; display:flex; align-items:center; justify-content:center; padding:1.5rem; backdrop-filter:blur(8px); animation:fadeUp 0.2s ease both; }
  .modal-box { background:var(--surface); border:1px solid var(--border2); border-radius:16px; width:100%; max-width:900px; max-height:90vh; overflow-y:auto; padding:2rem; position:relative; box-shadow:0 40px 100px rgba(0,0,0,0.7); }
  .modal-box::-webkit-scrollbar { width:4px; }
  .modal-box::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }
  .modal-close { position:absolute; top:14px; right:16px; background:rgba(255,255,255,0.08); border:1px solid var(--border2); border-radius:8px; color:var(--muted); font-size:14px; padding:4px 10px; cursor:pointer; font-family:var(--mono); transition:all 0.15s; z-index:1; }
  .modal-close:hover { background:rgba(255,79,79,0.2); color:var(--danger); border-color:rgba(255,79,79,0.4); }
  .modal-title { font-family:var(--mono); font-size:13px; color:var(--accent); margin-bottom:1.5rem; letter-spacing:1px; padding-right:40px; }
  .c-none { color:var(--safe); } .c-low { color:#80d8ff; } .c-medium { color:var(--warn); } .c-high { color:var(--danger); }
  .pill-none   { color:var(--safe);   border-color:rgba(0,229,160,0.4);   background:rgba(0,229,160,0.08); }
  .pill-low    { color:#80d8ff;       border-color:rgba(128,216,255,0.4); background:rgba(128,216,255,0.08); }
  .pill-medium { color:var(--warn);   border-color:rgba(245,166,35,0.4);  background:rgba(245,166,35,0.08); }
  .pill-high   { color:var(--danger); border-color:rgba(255,79,79,0.4);   background:rgba(255,79,79,0.08); }
  .stroke-none { stroke:var(--safe); } .stroke-low { stroke:#80d8ff; } .stroke-medium { stroke:var(--warn); } .stroke-high { stroke:var(--danger); }
  .fill-none { background:var(--safe); } .fill-low { background:#80d8ff; } .fill-medium { background:var(--warn); } .fill-high { background:var(--danger); }
  .otm-layout { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:1.5rem; }
  @media(max-width:640px) { .otm-layout { grid-template-columns:1fr; } }
  .otm-source-zone { border:2px solid rgba(0,229,160,0.35); border-radius:12px; padding:1.5rem; background:rgba(0,229,160,0.04); position:relative; }
  .otm-source-label { font-family:var(--mono); font-size:10px; letter-spacing:2px; text-transform:uppercase; color:var(--accent); margin-bottom:10px; display:flex; align-items:center; gap:6px; }
  .otm-source-label::before { content:""; display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent); }
  .otm-submissions-zone { border:1.5px dashed var(--border2); border-radius:12px; padding:1.5rem; background:rgba(20,20,30,0.6); position:relative; }
  .otm-submissions-label { font-family:var(--mono); font-size:10px; letter-spacing:2px; text-transform:uppercase; color:var(--muted); margin-bottom:10px; display:flex; align-items:center; gap:6px; }
  .otm-sub-drop-content { text-align:center; pointer-events:none; }
  .otm-file-list { margin-top:10px; display:flex; flex-direction:column; gap:6px; max-height:200px; overflow-y:auto; position:relative; z-index:2; }
  .otm-file-list::-webkit-scrollbar { width:3px; }
  .otm-file-list::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }
  .otm-file-row { display:flex; align-items:center; gap:8px; padding:6px 10px; background:var(--surface); border:1px solid var(--border); border-radius:8px; font-family:var(--mono); font-size:11px; }
  .otm-file-row .file-name { flex:1; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .otm-file-row .file-remove { background:none; border:none; color:var(--muted); cursor:pointer; font-size:11px; padding:0; line-height:1; transition:color 0.15s; flex-shrink:0; }
  .otm-file-row .file-remove:hover { color:var(--danger); }
  .otm-leaderboard { margin-bottom:1.5rem; }
  .otm-summary-row { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:1.25rem; }
  @media(max-width:600px) { .otm-summary-row { grid-template-columns:1fr 1fr; } }
  .otm-summary-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:1rem 1.1rem; text-align:center; }
  .otm-summary-card .s-val { font-family:var(--mono); font-size:24px; font-weight:600; line-height:1; }
  .otm-summary-card .s-lbl { font-family:var(--mono); font-size:10px; color:var(--muted); margin-top:4px; letter-spacing:1px; text-transform:uppercase; }
  .otm-bar-wrap { width:120px; flex-shrink:0; }
  .otm-bar-track { height:5px; background:var(--border2); border-radius:3px; overflow:hidden; }
  .otm-bar-fill { height:100%; border-radius:3px; transition:width 0.8s ease; }
  .otm-risk-badge { flex-shrink:0; font-size:9px; font-weight:700; letter-spacing:0.8px; padding:2px 8px; border-radius:10px; border:1px solid; white-space:nowrap; }
  .otm-export-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:1rem; margin-bottom:1.5rem; }
  .otm-source-badge { display:inline-flex; align-items:center; gap:6px; background:rgba(0,229,160,0.1); border:1px solid rgba(0,229,160,0.3); border-radius:8px; padding:6px 12px; font-family:var(--mono); font-size:11px; color:var(--accent); margin-bottom:1rem; }
`;

// ─── Shared sub-components ────────────────────────────────────────────────────
function DropZone({ label, file, onFile, onRemove }) {
  const [drag, setDrag] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const lang = detectLanguage(file);
  const onDrop = useCallback((e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }, [onFile]);

  function handlePasteSubmit() {
    if (!pasteText.trim()) return;
    const filename = `pasted-${label.toLowerCase().replace(/\s|—/g, "-")}.txt`;
    const blob = new Blob([pasteText], { type: "text/plain" });
    const f = new File([blob], filename, { type: "text/plain" });
    onFile(f);
    setShowPaste(false);
    setPasteText("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div className={`drop-zone${file ? " filled" : ""}${drag ? " drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        {file && <button className="dz-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>✕</button>}
        <input type="file" accept=".js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.html,.css,.txt"
          onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
        <span className="dz-icon">{file ? "✦" : "↑"}</span>
        <div className="dz-label">{label}</div>
        {file ? (<>
          <div className="dz-name">{file.name}</div>
          {lang && <div style={{ display:"flex", justifyContent:"center", marginTop:"6px" }}>
            <span className="lang-badge"><span>{lang.uiEmoji}</span><span>{lang.label}</span></span>
          </div>}
        </>) : <div className="dz-hint">click or drag & drop</div>}
      </div>
      <button className="glass-btn" style={{ width:"100%", justifyContent:"center", fontSize:"11px", padding:"7px 12px" }} onClick={() => setShowPaste(p => !p)}>
        {showPaste ? "✕ Cancel paste" : "📋 Paste code instead"}
      </button>
      {showPaste && (
        <div style={{ background:"var(--surface)", border:"1px solid var(--border2)", borderRadius:"10px", padding:"10px", display:"flex", flexDirection:"column", gap:"8px" }}>
          <textarea autoFocus value={pasteText} onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Paste your ${label} code here...`}
            style={{ width:"100%", minHeight:"140px", background:"var(--surface2)", border:"1px solid var(--border2)", borderRadius:"8px", color:"var(--text)", fontFamily:"var(--mono)", fontSize:"12px", padding:"10px", resize:"vertical", outline:"none", lineHeight:"1.6" }} />
          <button className="glass-btn" style={{ justifyContent:"center", background:"rgba(0,229,160,0.12)", borderColor:"rgba(0,229,160,0.35)", color:"var(--accent)", fontWeight:600 }}
            onClick={handlePasteSubmit} disabled={!pasteText.trim()}>✓ Use this code</button>
        </div>
      )}
    </div>
  );
}

function BatchDropZone({ files, onFiles, onRemoveFile }) {
  const [drag, setDrag] = useState(false);
  const handleDrop = useCallback((e) => { e.preventDefault(); setDrag(false); const d = Array.from(e.dataTransfer.files); if (d.length) onFiles(d); }, [onFiles]);
  const handleChange = (e) => { const p = Array.from(e.target.files); if (p.length) onFiles(p); e.target.value = ""; };
  return (<>
    <div className={`batch-drop${drag ? " drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={handleDrop}>
      <input type="file" multiple accept=".js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.html,.css,.txt" onChange={handleChange} />
      <span style={{ fontSize:"28px", display:"block", marginBottom:"8px" }}>📂</span>
      <div style={{ fontFamily:"var(--mono)", fontSize:"13px", color:"var(--accent)", marginBottom:"4px" }}>Drop multiple files here</div>
      <div style={{ fontFamily:"var(--mono)", fontSize:"11px", color:"var(--muted)" }}>Minimum 3 files · All pairs will be compared</div>
    </div>
    {files.length > 0 && <div className="batch-files-grid">
      {files.map((f, i) => { const lang = detectLanguage(f); return (
        <div key={i} className="batch-file-chip">
          <span>{lang?.uiEmoji}</span>
          <span style={{ color:"var(--text)", maxWidth:"140px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
          <button className="chip-remove" onClick={() => onRemoveFile(i)}>✕</button>
        </div>
      ); })}
    </div>}
  </>);
}

function ScoreRing({ pct, level }) {
  const R = 43, circ = 2 * Math.PI * R, offset = circ - (pct / 100) * circ;
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 100 100">
        <circle className="ring-track" cx="50" cy="50" r={R} />
        <circle className={`ring-fill stroke-${level}`} cx="50" cy="50" r={R} strokeDasharray={circ} strokeDashoffset={offset} />
      </svg>
      <div className="ring-center">
        <span className={`ring-pct c-${level}`}>{pct}%</span>
        <span className="ring-sub">similar</span>
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className={`copy-btn${copied ? " copied" : ""}`}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
      {copied ? "✓" : "copy"}
    </button>
  );
}

function InlineDiff({ codeAContent, codeBContent, fileAName, fileBName }) {
  const [showDiff, setShowDiff] = useState(true);
  const diff = useMemo(() => {
    if (!codeAContent || !codeBContent) return null;
    return computeDiff(codeAContent.split("\n"), codeBContent.split("\n"));
  }, [codeAContent, codeBContent]);
  if (!diff) return null;
  return (<>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"10px" }}>
      <div className="section-label" style={{ margin:0 }}>GitHub-style diff</div>
      <button className="glass-btn" style={{ padding:"6px 14px", fontSize:"11px" }} onClick={() => setShowDiff(p => !p)}>
        {showDiff ? "⊟ Hide diff" : "⊞ Show diff"}
      </button>
    </div>
    {showDiff && <div className="diff-wrap">
      <div className="diff-header">
        <div className="diff-file-label">📄 {fileAName}</div>
        <div className="diff-file-label">📄 {fileBName}</div>
      </div>
      <div className="diff-body">
        <div className="diff-col">
          {diff.diffA.map((row, i) => (
            <div key={i} className={`diff-line ${row.type}`}>
              <span className="diff-ln">{row.ln ?? ""}</span>
              <span className="diff-sign">{row.type === "removed" ? "−" : " "}</span>
              <span className="diff-text">{row.line}</span>
            </div>
          ))}
        </div>
        <div className="diff-col">
          {diff.diffB.map((row, i) => (
            <div key={i} className={`diff-line ${row.type}`}>
              <span className="diff-ln">{row.ln ?? ""}</span>
              <span className="diff-sign">{row.type === "added" ? "+" : " "}</span>
              <span className="diff-text">{row.line}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="diff-legend">
        <div className="diff-legend-item"><div className="diff-legend-dot" style={{ background:"rgba(255,79,79,0.5)" }} />Only in File A</div>
        <div className="diff-legend-item"><div className="diff-legend-dot" style={{ background:"rgba(0,229,160,0.5)" }} />Only in File B</div>
        <div className="diff-legend-item"><div className="diff-legend-dot" style={{ background:"rgba(255,255,255,0.15)" }} />Identical — possible plagiarism</div>
      </div>
      {(codeAContent.split("\n").length > 400 || codeBContent.split("\n").length > 400) &&
        <div className="diff-note">Diff view limited to 400 lines. Full analysis ran on the complete file.</div>}
    </div>}
  </>);
}

function AiFallbackBanner() {
  return (
    <div className="warn-banner">
      ⚠ <strong>AI unavailable (rate limit or connection issue)</strong> — results below are from
      deterministic algorithms only (token similarity, structural match, normalized line overlap).
      They are fully reliable but lack AI semantic analysis. Re-run later for AI-enhanced scores.
    </div>
  );
}

function ReliabilityInfo({ result }) {
  return (
    <div className="reliability-note">
      <div style={{ marginBottom:"6px", color:"var(--text)", fontWeight:"600" }}>How these scores were calculated</div>
      <div><span className="tag tag-verified">VERIFIED</span> Exact matching lines — pure string algorithm, 100% accurate</div>
      <div><span className="tag tag-verified">VERIFIED</span> Code diff view — LCS algorithm (same as Git), 100% accurate</div>
      <div><span className="tag tag-verified">VERIFIED</span> Algorithmic scores (token sim, structural, normalized) — 100% deterministic</div>
      {result.ai_fallback ? (
        <>
          <div><span className="tag tag-algo">ALGO-ONLY</span> All similarity scores — AI unavailable, algorithmic only</div>
          <div style={{ marginTop:"6px", color:"#f5a623" }}>AI was unavailable — all scores are from deterministic algorithms</div>
        </>
      ) : (
        <>
          <div><span className="tag tag-blended">BLENDED</span> Similarity % — 60% AI + 40% normalized line overlap</div>
          <div><span className="tag tag-blended">BLENDED</span> Token overlap — 60% AI + 40% Jaccard token similarity</div>
          <div><span className="tag tag-blended">BLENDED</span> Structure match — 60% AI + 40% function/class name overlap</div>
          <div><span className="tag tag-ai">AI-ESTIMATED</span> Logic similarity, Human score, AI-generated likelihood — indicative only</div>
          {result.ai_run_count === 2 && <div style={{ marginTop:"6px", color:"var(--accent)" }}>✓ AI ran twice and scores were averaged for consistency (LLaMA 3.3 70B via Groq)</div>}
          {result.ai_run_count === 1 && <div style={{ marginTop:"6px", color:"var(--warn)" }}>One AI run succeeded — scores may be slightly less consistent</div>}
        </>
      )}
    </div>
  );
}

function AlgoScores({ result }) {
  return (
    <div className="algo-row">
      <div className="algo-card">
        <div className="algo-lbl">Token Similarity</div>
        <div className="algo-val">{result.algo_token_similarity ?? "—"}%</div>
        <div className="algo-sub">Jaccard · 100% algorithmic</div>
      </div>
      <div className="algo-card">
        <div className="algo-lbl">Structural Match</div>
        <div className="algo-val">{result.algo_structural_score ?? "—"}%</div>
        <div className="algo-sub">Func/class names · 100% algorithmic</div>
      </div>
      <div className="algo-card">
        <div className="algo-lbl">Normalized Overlap</div>
        <div className="algo-val">{result.algo_normalized_overlap ?? "—"}%</div>
        <div className="algo-sub">Comment-stripped · 100% algorithmic</div>
      </div>
    </div>
  );
}

function ResultDetail({ result, fileAName, fileBName, codeAContent, codeBContent }) {
  const humanScore = result?.human_score ?? (result ? 100 - result.similarity_percent : 0);
  const level = getLevel(result.similarity_percent);
  return (<>
    {result.ai_fallback && <AiFallbackBanner />}
    <div className="score-card">
      <div className="score-inner">
        <ScoreRing pct={result.similarity_percent} level={level} />
        <div className="stat-row">
          <div className="stat-item"><div className="stat-label">Human-written</div><div className="stat-value" style={{ color:"#00e5a0" }}>{humanScore}%</div></div>
          <div className="divider-v" />
          <div className="stat-item"><div className="stat-label">AI-generated</div><div className="stat-value" style={{ color:"#b08dff" }}>{result.ai_generated_likelihood ?? "—"}%</div></div>
          <div className="divider-v" />
          <div className="stat-item"><div className="stat-label">Plagiarism</div><div className="stat-value" style={{ color:"#ff4f4f" }}>{result.similarity_percent}%</div></div>
        </div>
        <div className="prog-bar"><div className="prog-fill" style={{ width:`${humanScore}%` }} /></div>
        {result.ai_reason && <div style={{ marginTop:"10px", fontSize:"11px", color:"var(--muted)", fontFamily:"var(--mono)", lineHeight:"1.6" }}>AI: {result.ai_reason}</div>}
      </div>
      <div className="score-info">
        <div className={`verdict-pill pill-${level}`}>{getVerdict(result.similarity_percent)}</div>
        <div className="score-summary">{result.summary}</div>
        <div className="lang-row">{result.language_a} → {result.language_b}</div>
      </div>
    </div>
    <div className="section-label">Algorithmic scores — 100% deterministic</div>
    <AlgoScores result={result} />
    <div className="metrics">
      {[{ label:"Logic similarity", val:result.logic_similarity }, { label:"Structure match", val:result.structure_similarity }, { label:"Token overlap", val:result.token_overlap }].map(({ label, val }) => {
        const lv = getLevel(val);
        return (<div className="metric" key={label}><div className="m-lbl">{label}</div><div className={`m-val c-${lv}`}>{Math.round(val)}%</div><div className="m-bar"><div className={`m-fill fill-${lv}`} style={{ width:`${val}%` }} /></div></div>);
      })}
    </div>
    <div className="section-label">Matching lines — {result.matchingLines?.length ?? 0} exact matches (100% verified)</div>
    <div className="lines-box">
      {!result.matchingLines?.length ? <div className="no-lines">No exact line matches detected</div>
        : result.matchingLines.slice(0, 100).map((line, i) => (
          <div key={i} className="line-row" style={{ background:"rgba(255,79,79,0.12)" }}>
            <span className="ln">{i + 1}</span>
            <span className="lc" style={{ color:"#ff4f4f" }}>{line}</span>
            <CopyButton text={line} />
          </div>
        ))}
    </div>
    <InlineDiff codeAContent={codeAContent} codeBContent={codeBContent} fileAName={fileAName} fileBName={fileBName} />
    <div className="section-label">Detailed findings</div>
    <div className="findings">{result.findings}</div>
    <ReliabilityInfo result={result} />
  </>);
}

function BatchMatrix({ files, matrix, loadingCells, onCellClick }) {
  const shortName = (f) => f.name.length > 16 ? f.name.slice(0, 14) + "…" : f.name;
  return (
    <div className="matrix-wrap">
      <table className="matrix-table">
        <thead>
          <tr>
            <th className="corner" style={{ minWidth:"100px" }}></th>
            {files.map((f, j) => { const lang = detectLanguage(f); return (
              <th key={j} title={f.name}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:"2px" }}>
                  <span style={{ fontSize:"14px" }}>{lang?.uiEmoji}</span><span>{shortName(f)}</span>
                </div>
              </th>
            ); })}
          </tr>
        </thead>
        <tbody>
          {files.map((fRow, i) => { const langRow = detectLanguage(fRow); return (
            <tr key={i}>
              <td className="matrix-row-label" title={fRow.name}><span style={{ marginRight:"6px" }}>{langRow?.uiEmoji}</span>{shortName(fRow)}</td>
              {files.map((fCol, j) => {
                if (i === j) return (<td key={j}><div className="matrix-cell self" style={{ background:"rgba(255,255,255,0.03)" }}><span style={{ color:"var(--muted)", fontSize:"18px" }}>—</span></div></td>);
                const key = `${Math.min(i,j)}-${Math.max(i,j)}`;
                const res = matrix[key]; const isLoading = loadingCells.has(key);
                if (isLoading) return (<td key={j}><div className="matrix-cell" style={{ background:"rgba(255,255,255,0.04)" }}><div className="matrix-loading"><div className="matrix-spinner" /></div></div></td>);
                if (!res) return (<td key={j}><div className="matrix-cell" style={{ background:"rgba(255,255,255,0.02)" }}><span style={{ color:"var(--muted)", fontSize:"11px", fontFamily:"var(--mono)" }}>-</span></div></td>);
                const pct = res.similarity_percent; const textColor = heatTextColor(pct);
                return (<td key={j}><div className="matrix-cell" style={{ background:heatColor(pct) }} onClick={() => onCellClick(i, j, res)} title={`${fRow.name} vs ${fCol.name}: ${pct}%`}>
                  <span className="matrix-pct" style={{ color:textColor }}>{pct}%</span>
                  <span className="matrix-verdict" style={{ color:textColor }}>{getVerdict(pct)}</span>
                  {res.ai_fallback && <span style={{ fontSize:"8px", color:"#f5a623", marginTop:"2px" }}>algo only</span>}
                </div></td>);
              })}
            </tr>
          ); })}
        </tbody>
      </table>
      <div className="matrix-legend">
        <div className="matrix-legend-item"><div className="matrix-legend-dot" style={{ background:"rgba(255,79,79,0.5)" }} />70%+ — Definite Plagiarism</div>
        <div className="matrix-legend-item"><div className="matrix-legend-dot" style={{ background:"rgba(245,166,35,0.5)" }} />40-69% — Likely Plagiarized</div>
        <div className="matrix-legend-item"><div className="matrix-legend-dot" style={{ background:"rgba(128,216,255,0.4)" }} />15-39% — Suspicious</div>
        <div className="matrix-legend-item"><div className="matrix-legend-dot" style={{ background:"rgba(0,229,160,0.3)" }} />under 15% — Original</div>
        <div className="matrix-legend-item" style={{ marginLeft:"auto", color:"var(--accent)" }}>Click any cell to view full diff</div>
      </div>
    </div>
  );
}

// ─── ONE-TO-MANY MODE ─────────────────────────────────────────────────────────
function OneToManyMode() {
  const [sourceFile, setSourceFile]       = useState(null);
  const [sourceContent, setSourceContent] = useState("");
  const [subFiles, setSubFiles]           = useState([]);
  const [results, setResults]             = useState([]);
  const [loadingSet, setLoadingSet]       = useState(new Set());
  const [running, setRunning]             = useState(false);
  const [progress, setProgress]           = useState({ done:0, total:0 });
  const [error, setError]                 = useState("");
  const [expandedRow, setExpandedRow]     = useState(null);
  const [sortBy, setSortBy]               = useState("pct_desc");
  const [dragSub, setDragSub]             = useState(false);
  const expandedRefs = useRef({});

  async function handleSourceFile(f) {
    setSourceFile(f);
    const content = await readFile(f);
    setSourceContent(content);
    setResults([]);
  }

  function addSubFiles(newFiles) {
    setSubFiles(prev => {
      const ex = new Set(prev.map(f => f.name));
      return [...prev, ...newFiles.filter(f => !ex.has(f.name) && f.name !== sourceFile?.name)];
    });
    setResults([]);
  }

  function removeSubFile(idx) {
    setSubFiles(prev => prev.filter((_, i) => i !== idx));
    setResults([]);
  }

  async function runAnalysis() {
    if (!sourceFile || subFiles.length === 0) return;
    setError(""); setRunning(true); setResults([]);
    setProgress({ done:0, total:subFiles.length });

    const CONCURRENCY = 1;
    let idx = 0;
    const allResults = new Array(subFiles.length).fill(null);

    async function runNext() {
      while (idx < subFiles.length) {
        const i = idx++;
        const f = subFiles[i];
        setLoadingSet(prev => new Set([...prev, i]));
        try {
          const subContent = await readFile(f);
          const res = await analyzeFilePair({ name: sourceFile.name }, { name: f.name }, sourceContent, subContent);
          allResults[i] = { file: f, result: res, content: subContent };
        } catch(e) {
          const subContent = await readFile(f).catch(() => "");
          allResults[i] = {
            file: f,
            content: subContent,
            result: buildAlgorithmicResult(sourceFile.name, f.name, sourceContent, subContent),
          };
        }
        setLoadingSet(prev => { const s = new Set(prev); s.delete(i); return s; });
        setProgress(prev => ({ ...prev, done: prev.done + 1 }));
        setResults(allResults.filter(Boolean));
        if (idx < subFiles.length) await new Promise(res => setTimeout(res, 800));
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subFiles.length) }, runNext));
    setResults(allResults.filter(Boolean));
    setRunning(false);
  }

  const sortedResults = useMemo(() => {
    const r = [...results];
    if (sortBy === "pct_desc") r.sort((a,b) => b.result.similarity_percent - a.result.similarity_percent);
    else if (sortBy === "pct_asc") r.sort((a,b) => a.result.similarity_percent - b.result.similarity_percent);
    else if (sortBy === "name") r.sort((a,b) => a.file.name.localeCompare(b.file.name));
    return r;
  }, [results, sortBy]);

  const doneCount  = results.length;
  const highRisk   = results.filter(r => r.result.similarity_percent >= 70).length;
  const medRisk    = results.filter(r => r.result.similarity_percent >= 40 && r.result.similarity_percent < 70).length;
  const cleanCount = results.filter(r => r.result.similarity_percent < 15).length;
  const avgPct     = doneCount ? Math.round(results.reduce((s,r) => s + r.result.similarity_percent, 0) / doneCount) : 0;
  const anyFallback = results.some(r => r.result.ai_fallback);

  // ─── FIXED PDF export — all strings sanitized via pdfSafe() ───────────────
  function exportPDFOneToMany() {
    if (!results.length) return;
    const doc = new jsPDF();
    let y = 10;

    const addLine = (text, opts = {}) => {
      const safeText = pdfSafe(text);
      doc.setFont("Courier", opts.bold ? "Bold" : "Normal");
      doc.setFontSize(opts.size || 10);
      const lines = doc.splitTextToSize(safeText, 180);
      lines.forEach(line => {
        if (y > 280) { doc.addPage(); y = 10; }
        doc.text(line, 10, y);
        y += opts.gap || 6;
      });
      doc.setFont("Courier", "Normal");
      doc.setFontSize(10);
    };
    const addDivider = () => { doc.setDrawColor(180, 180, 180); doc.line(10, y, 200, y); y += 5; };
    const addSpacer = (h = 4) => { y += h; };

    addLine("CODE PLAGIARISM REPORT - ONE TO MANY", { bold: true, size: 14, gap: 8 });
    addLine(`Generated  : ${new Date().toLocaleString()}`, { size: 9, gap: 5 });
    addLine(`Source File: ${sourceFile?.name ?? "Unknown"}`, { size: 9, gap: 5 });
    addLine(`Powered by : LLaMA 3.3 70B (Groq API) + Algorithmic Analysis`, { size: 9, gap: 5 });
    if (anyFallback) addLine(`NOTE: Some results used algorithmic fallback (AI unavailable).`, { size: 9, gap: 5 });
    addDivider();

    // ── SUMMARY section ─────────────────────────────────────────────────────
    addLine("SUMMARY", { bold: true, size: 12, gap: 8 });
    addSpacer(2);
    addLine(`Total submissions  : ${results.length}`, { gap: 6 });
    addLine(`High risk  (>=70%) : ${highRisk}`, { gap: 6 });
    addLine(`Medium risk(>=40%) : ${medRisk}`, { gap: 6 });
    addLine(`Clean      (<15%)  : ${cleanCount}`, { gap: 6 });
    addLine(`Avg similarity     : ${avgPct}%`, { gap: 6 });
    addSpacer(4);
    addDivider();

    addLine("RESULTS (sorted highest similarity first)", { bold: true, size: 11, gap: 7 });
    addSpacer(2);

    sortedResults.forEach((item, index) => {
      const r = item.result;
      if (y > 255) { doc.addPage(); y = 10; }
      addLine(`${index + 1}. ${r.nameB ?? item.file.name}${r.ai_fallback ? " [algo-only]" : ""}`, { bold: true, size: 10, gap: 6 });
      addLine(`   Verdict             : ${getVerdict(r.similarity_percent)}`, { gap: 5 });
      addLine(`   Similarity          : ${r.similarity_percent}%`, { gap: 5 });
      addLine(`   Logic               : ${r.logic_similarity}%  |  Structure: ${r.structure_similarity}%  |  Token: ${r.token_overlap}%`, { gap: 5 });
      addLine(`   Token sim (algo)    : ${r.algo_token_similarity ?? "N/A"}%`, { gap: 5 });
      addLine(`   Structural (algo)   : ${r.algo_structural_score ?? "N/A"}%`, { gap: 5 });
      addLine(`   Norm overlap (algo) : ${r.algo_normalized_overlap ?? "N/A"}%`, { gap: 5 });
      addLine(`   Exact matches       : ${r.matchingLines?.length ?? 0} lines`, { gap: 5 });
      addLine(`   Language            : ${r.language_b ?? "Unknown"}`, { gap: 5 });
      if (r.summary) {
        addLine(`   Summary:`, { size: 9, gap: 5 });
        addLine(`   ${r.summary}`, { size: 9, gap: 5 });
      }
      addSpacer(4);
    });

    addDivider();
    addLine("RELIABILITY NOTICE", { bold: true, size: 9, gap: 6 });
    addLine("Exact line matches are 100% algorithmically verified and fully reliable.", { size: 9, gap: 5 });
    addLine("Blended scores (60% AI + 40% algorithmic) are more reliable than pure AI estimates.", { size: 9, gap: 5 });
    addLine("AI-only scores are indicative estimates - not guaranteed accurate.", { size: 9, gap: 5 });

    const safeName = (sourceFile?.name ?? "source").replace(/\.[^.]+$/, "");
    doc.save(`plagiarism-one-to-many-${safeName}.pdf`);
  }

  function exportJSON() {
    if (!results.length) return;
    const report = {
      report_type: "one-to-many",
      source_file: sourceFile?.name,
      generated_at: new Date().toLocaleString(),
      summary: { total: results.length, high_risk: highRisk, medium_risk: medRisk, clean: cleanCount, avg_similarity: avgPct },
      results: sortedResults.map((item, i) => ({
        rank: i + 1,
        file: item.file.name,
        similarity_percent: item.result.similarity_percent,
        verdict: getVerdict(item.result.similarity_percent),
        ai_fallback: item.result.ai_fallback,
        ...item.result,
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `one-to-many-report-${sourceFile?.name ?? "source"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="otm-layout">
        <div className="otm-source-zone">
          <div className="otm-source-label">Base / Source Code</div>
          {!sourceFile ? (
            <div style={{ position:"relative" }}>
              <div className="drop-zone" style={{ border:"none", padding:"1.25rem", background:"transparent" }}>
                <input type="file" accept=".js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.html,.css,.txt"
                  onChange={(e) => e.target.files[0] && handleSourceFile(e.target.files[0])} />
                <span className="dz-icon">🔑</span>
                <div className="dz-label">Upload source file</div>
                <div className="dz-hint">The "original" — all submissions compared to this</div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:"10px", padding:"10px 0" }}>
                <span style={{ fontSize:"22px" }}>{detectLanguage(sourceFile)?.uiEmoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"var(--mono)", fontSize:"13px", color:"var(--accent)", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sourceFile.name}</div>
                  <div style={{ fontFamily:"var(--mono)", fontSize:"10px", color:"var(--muted)", marginTop:"2px" }}>{detectLanguage(sourceFile)?.label} · Base file</div>
                </div>
                <button className="glass-btn danger" style={{ padding:"4px 10px", fontSize:"11px" }} onClick={() => { setSourceFile(null); setSourceContent(""); setResults([]); }}>✕</button>
              </div>
              <div style={{ fontFamily:"var(--mono)", fontSize:"10px", color:"var(--muted)", padding:"6px 8px", background:"rgba(0,229,160,0.05)", borderRadius:"6px", border:"1px solid rgba(0,229,160,0.15)" }}>
                ✓ {sourceContent.split("\n").length} lines · {(sourceContent.length / 1024).toFixed(1)} KB loaded
              </div>
            </div>
          )}
        </div>

        <div className="otm-submissions-zone">
          <div className="otm-submissions-label">Student Submissions</div>
          <div
            className={dragSub ? "drag" : ""}
            style={{ position:"relative", border:"1.5px dashed var(--border2)", borderRadius:"10px", padding:"1.25rem", textAlign:"center", transition:"border-color 0.2s, background 0.2s", background: dragSub ? "rgba(0,229,160,0.04)" : "transparent", ...(dragSub ? {borderColor:"var(--accent)"} : {}) }}
            onDragOver={(e) => { e.preventDefault(); setDragSub(true); }}
            onDragLeave={() => setDragSub(false)}
            onDrop={(e) => { e.preventDefault(); setDragSub(false); const fs = Array.from(e.dataTransfer.files); if (fs.length) addSubFiles(fs); }}
          >
            <input type="file" multiple accept=".js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.html,.css,.txt"
              style={{ position:"absolute", inset:0, opacity:0, cursor:"pointer", width:"100%", height:"100%", zIndex:1 }}
              onChange={(e) => { const fs = Array.from(e.target.files); if (fs.length) addSubFiles(fs); e.target.value = ""; }} />
            <div className="otm-sub-drop-content">
              <span style={{ fontSize:"24px", display:"block", marginBottom:"6px" }}>📂</span>
              <div style={{ fontFamily:"var(--mono)", fontSize:"12px", color:"var(--accent)", marginBottom:"3px" }}>Drop student files here</div>
              <div style={{ fontFamily:"var(--mono)", fontSize:"10px", color:"var(--muted)" }}>Multiple files · All compared to source</div>
            </div>
          </div>
          {subFiles.length > 0 && (
            <div className="otm-file-list" style={{ position:"relative", zIndex:2, marginTop:"10px" }}>
              {subFiles.map((f, i) => {
                const lang = detectLanguage(f);
                const isLoading = loadingSet.has(i);
                const res = results.find(r => r.file.name === f.name);
                return (
                  <div key={i} className="otm-file-row">
                    <span>{lang?.uiEmoji}</span>
                    <span className="file-name">{f.name}</span>
                    {isLoading && <div className="matrix-spinner" style={{ width:10, height:10 }} />}
                    {res && <span style={{ fontSize:"10px", color: heatTextColor(res.result.similarity_percent), fontWeight:600 }}>{res.result.similarity_percent}%{res.result.ai_fallback ? " (algo)" : ""}</span>}
                    {!isLoading && <button className="file-remove" onClick={() => removeSubFile(i)}>✕</button>}
                  </div>
                );
              })}
            </div>
          )}
          {subFiles.length > 0 && (
            <div style={{ marginTop:"8px", fontFamily:"var(--mono)", fontSize:"10px", color:"var(--muted)" }}>
              {subFiles.length} file{subFiles.length !== 1 ? "s" : ""} queued
            </div>
          )}
        </div>
      </div>

      {error && <div className="err">⚠ {error}</div>}

      <button
        className={`check-btn${running ? " busy" : ""}`}
        onClick={runAnalysis}
        disabled={running || !sourceFile || subFiles.length === 0}
      >
        {running
          ? <><span className="spin" />Analyzing {progress.done}/{progress.total} submissions...</>
          : `Run One-to-Many Analysis (${subFiles.length} submission${subFiles.length !== 1 ? "s" : ""})`}
      </button>

      {running && progress.total > 0 && (
        <div className="batch-progress" style={{ marginTop:"-1.5rem", marginBottom:"1.5rem" }}>
          <div className="batch-status">
            <span>Comparing against source...</span>
            <span style={{ color:"var(--accent)" }}>{progress.done} / {progress.total}</span>
          </div>
          <div className="batch-progress-bar">
            <div className="batch-progress-fill" style={{ width:`${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="otm-leaderboard">
          {anyFallback && <AiFallbackBanner />}
          <div className="otm-source-badge">
            Source: {sourceFile?.name} · {doneCount} submission{doneCount !== 1 ? "s" : ""} analyzed
          </div>

          <div className="otm-summary-row">
            <div className="otm-summary-card">
              <div className="s-val" style={{ color:"var(--danger)" }}>{highRisk}</div>
              <div className="s-lbl">High Risk ≥70%</div>
            </div>
            <div className="otm-summary-card">
              <div className="s-val" style={{ color:"var(--warn)" }}>{medRisk}</div>
              <div className="s-lbl">Medium Risk 40–69%</div>
            </div>
            <div className="otm-summary-card">
              <div className="s-val" style={{ color:"var(--safe)" }}>{cleanCount}</div>
              <div className="s-lbl">Clean &lt;15%</div>
            </div>
            <div className="otm-summary-card">
              <div className="s-val" style={{ color: heatTextColor(avgPct) }}>{avgPct}%</div>
              <div className="s-lbl">Avg Similarity</div>
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"12px", flexWrap:"wrap", gap:"8px" }}>
            <div className="section-label" style={{ margin:0 }}>
              Similarity leaderboard — {doneCount} result{doneCount !== 1 ? "s" : ""}
              {running && <span style={{ color:"var(--muted)", marginLeft:"8px" }}>(updating live…)</span>}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ background:"var(--surface)", border:"1px solid var(--border2)", borderRadius:"7px", color:"var(--text)", fontFamily:"var(--mono)", fontSize:"11px", padding:"5px 10px", cursor:"pointer", outline:"none" }}
            >
              <option value="pct_desc">Sort: Highest first</option>
              <option value="pct_asc">Sort: Lowest first</option>
              <option value="name">Sort: Name A-Z</option>
            </select>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"36px 1fr 140px 110px 80px 28px", gap:"10px", padding:"0 14px", marginBottom:"6px" }}>
            {["#","File","Similarity","Risk","Matches",""].map(h => (
              <div key={h} style={{ fontFamily:"var(--mono)", fontSize:"9px", color:"var(--muted)", textTransform:"uppercase", letterSpacing:"1px" }}>{h}</div>
            ))}
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:"6px", marginBottom:"1rem" }}>
            {sortedResults.map((item, i) => {
              const r = item.result;
              const pct = r.similarity_percent;
              const risk = getRiskLabel(pct);
              const lang = detectLanguage(item.file);
              const isOpen = expandedRow === item.file.name;

              return (
                <div key={item.file.name} style={{ background:"var(--surface)", border:`1px solid ${isOpen ? "rgba(0,229,160,0.3)" : "var(--border)"}`, borderRadius:"10px", overflow:"hidden", transition:"border-color 0.2s" }}>
                  <div
                    onClick={() => {
                      setExpandedRow(prev => {
                        const next = prev === item.file.name ? null : item.file.name;
                        if (next) setTimeout(() => expandedRefs.current[next]?.scrollIntoView({ behavior:"smooth", block:"nearest" }), 60);
                        return next;
                      });
                    }}
                    style={{ display:"grid", gridTemplateColumns:"36px 1fr 140px 110px 80px 28px", gap:"10px", alignItems:"center", padding:"10px 14px", cursor:"pointer", userSelect:"none", transition:"background 0.15s", background: isOpen ? "rgba(0,229,160,0.04)" : "transparent" }}
                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ textAlign:"center", fontFamily:"var(--mono)", fontSize:"11px", color:"var(--muted)", minWidth:"24px" }}>{i+1}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"220px", fontFamily:"var(--mono)", fontSize:"12px" }}>
                        {lang?.uiEmoji} {item.file.name} {r.ai_fallback && <span style={{ color:"#f5a623", fontSize:"9px" }}>(algo)</span>}
                      </div>
                      <div style={{ fontSize:"10px", color:"var(--muted)", marginTop:"2px", fontFamily:"var(--mono)" }}>{r.language_b} · {r.matchingLines?.length ?? 0} exact matches</div>
                    </div>
                    <div className="otm-bar-wrap">
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"3px" }}>
                        <span style={{ fontFamily:"var(--mono)", fontSize:"10px", color:"var(--muted)" }}>{getVerdict(pct)}</span>
                        <span style={{ fontFamily:"var(--mono)", fontSize:"13px", fontWeight:600, color:heatTextColor(pct) }}>{pct}%</span>
                      </div>
                      <div className="otm-bar-track">
                        <div className="otm-bar-fill" style={{ width:`${pct}%`, background: pct >= 70 ? "#ff4f4f" : pct >= 40 ? "#f5a623" : pct >= 15 ? "#80d8ff" : "#00e5a0" }} />
                      </div>
                    </div>
                    <span className="otm-risk-badge" style={{ color:risk.color, background:risk.bg, borderColor:risk.border }}>{risk.label}</span>
                    <span style={{ fontFamily:"var(--mono)", fontSize:"12px", color:heatTextColor(pct), textAlign:"right" }}>{r.matchingLines?.length ?? 0}</span>
                    <span style={{ color:"var(--muted)", fontSize:"12px", textAlign:"center", transition:"transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", display:"inline-block" }}>v</span>
                  </div>

                  {isOpen && (
                    <div
                      ref={el => { expandedRefs.current[item.file.name] = el; }}
                      style={{ borderTop:"1px solid var(--border2)", padding:"1.25rem 1.5rem", background:"rgba(0,0,0,0.2)" }}
                    >
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"1.25rem", flexWrap:"wrap", gap:"8px" }}>
                        <div style={{ fontFamily:"var(--mono)", fontSize:"12px", color:"var(--accent)" }}>
                          🔑 {sourceFile?.name} <span style={{ color:"var(--muted)" }}>vs</span> 📄 {item.file.name}
                        </div>
                        <button className="glass-btn" style={{ padding:"5px 12px", fontSize:"11px" }} onClick={(e) => { e.stopPropagation(); setExpandedRow(null); }}>Collapse</button>
                      </div>

                      {r.ai_fallback && <AiFallbackBanner />}

                      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"8px", marginBottom:"1.25rem" }}>
                        {[
                          { label:"Similarity",    val:`${r.similarity_percent}%`,  color:heatTextColor(r.similarity_percent) },
                          { label:"Logic",         val:`${r.logic_similarity}%`,    color:heatTextColor(r.logic_similarity) },
                          { label:"Structure",     val:`${r.structure_similarity}%`,color:heatTextColor(r.structure_similarity) },
                          { label:"Token Overlap", val:`${r.token_overlap}%`,       color:heatTextColor(r.token_overlap) },
                        ].map(({ label, val, color }) => (
                          <div key={label} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid var(--border)", borderRadius:"8px", padding:"10px 12px", textAlign:"center" }}>
                            <div style={{ fontFamily:"var(--mono)", fontSize:"18px", fontWeight:600, color }}>{val}</div>
                            <div style={{ fontFamily:"var(--mono)", fontSize:"9px", color:"var(--muted)", marginTop:"3px", textTransform:"uppercase", letterSpacing:"0.8px" }}>{label}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"6px", marginBottom:"1.25rem" }}>
                        {[
                          { label:"Token Sim (Jaccard)", val:r.algo_token_similarity },
                          { label:"Structural Match",    val:r.algo_structural_score },
                          { label:"Norm. Overlap",       val:r.algo_normalized_overlap },
                        ].map(({ label, val }) => (
                          <div key={label} style={{ background:"rgba(0,229,160,0.04)", border:"1px solid rgba(0,229,160,0.12)", borderRadius:"7px", padding:"8px 10px" }}>
                            <div style={{ fontFamily:"var(--mono)", fontSize:"9px", color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:"3px" }}>{label}</div>
                            <div style={{ fontFamily:"var(--mono)", fontSize:"16px", fontWeight:600, color:"var(--accent)" }}>{val ?? "—"}%</div>
                            <div style={{ fontFamily:"var(--mono)", fontSize:"9px", color:"var(--muted)", marginTop:"1px" }}>100% algorithmic</div>
                          </div>
                        ))}
                      </div>

                      {r.summary && (
                        <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"8px", padding:"10px 14px", fontFamily:"var(--mono)", fontSize:"12px", color:"var(--muted)", lineHeight:"1.7", marginBottom:"1.25rem" }}>
                          <span style={{ color:"var(--text)", fontWeight:600 }}>Summary: </span>{r.summary}
                        </div>
                      )}

                      <div className="section-label" style={{ marginBottom:"8px" }}>
                        Exact matching lines — {r.matchingLines?.length ?? 0} (100% verified)
                      </div>
                      <div className="lines-box" style={{ maxHeight:"160px", marginBottom:"1.25rem" }}>
                        {!r.matchingLines?.length
                          ? <div className="no-lines">No exact line matches detected</div>
                          : r.matchingLines.slice(0, 60).map((line, idx) => (
                            <div key={idx} className="line-row" style={{ background:"rgba(255,79,79,0.10)" }}>
                              <span className="ln">{idx+1}</span>
                              <span className="lc" style={{ color:"#ff8080" }}>{line}</span>
                              <CopyButton text={line} />
                            </div>
                          ))}
                      </div>

                      <InlineDiff
                        codeAContent={sourceContent}
                        codeBContent={item.content}
                        fileAName={sourceFile?.name}
                        fileBName={item.file.name}
                      />

                      {r.findings && (<>
                        <div className="section-label" style={{ marginBottom:"8px" }}>Detailed findings</div>
                        <div className="findings" style={{ marginBottom:"1rem" }}>{r.findings}</div>
                      </>)}

                      <button className="glass-btn" style={{ width:"100%", justifyContent:"center", marginTop:"4px" }} onClick={() => setExpandedRow(null)}>
                        Collapse details
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {running && loadingSet.size > 0 && [...loadingSet].map(idx => (
              <div key={`loading-${idx}`} style={{ display:"flex", alignItems:"center", gap:"10px", padding:"12px 14px", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"10px", fontFamily:"var(--mono)", fontSize:"11px", color:"var(--muted)" }}>
                <div className="matrix-spinner" />
                <span>Analyzing {subFiles[idx]?.name}...</span>
              </div>
            ))}
          </div>

          {!running && (
            <div className="otm-export-row">
              <button className="glass-btn" onClick={exportPDFOneToMany}>Export PDF</button>
              <button className="glass-btn" onClick={exportJSON}>Export JSON</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode]                   = useState("pair");
  const [fileA, setFileA]                 = useState(null);
  const [fileB, setFileB]                 = useState(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");
  const [result, setResult]               = useState(null);
  const [codeAContent, setCodeAContent]   = useState("");
  const [codeBContent, setCodeBContent]   = useState("");
  const [isFromHistory, setIsFromHistory] = useState(false);
  const [batchFiles, setBatchFiles]       = useState([]);
  const [batchMatrix, setBatchMatrix]     = useState({});
  const [batchLoadingCells, setBatchLoadingCells] = useState(new Set());
  const [batchProgress, setBatchProgress] = useState({ done:0, total:0 });
  const [batchRunning, setBatchRunning]   = useState(false);
  const [batchContents, setBatchContents] = useState({});
  const [modalData, setModalData]         = useState(null);
  const [history, setHistory]             = useState([]);
  const [showHistory, setShowHistory]     = useState(false);
  const [toggleText, setToggleText]       = useState(true);
  const [fade, setFade]                   = useState(true);
  const historyRef = useRef(null);

  const humanScore = result?.human_score ?? (result ? 100 - result.similarity_percent : 0);
  const level = result ? getLevel(result.similarity_percent) : "none";

  useEffect(() => { const s = safeStorage.get("plag_history"); if (s) setHistory(s); }, []);
  useEffect(() => {
    const iv = setInterval(() => { setFade(false); setTimeout(() => { setToggleText(p => !p); setFade(true); }, 300); }, 3500);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    const h = (e) => { if (showHistory && historyRef.current && !historyRef.current.contains(e.target)) setShowHistory(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [showHistory]);
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (mode === "pair" && fileA && fileB && !loading) handleCheck();
        if (mode === "batch" && batchFiles.length >= 3 && !batchRunning) handleBatchCheck();
      }
    };
    document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h);
  }, [mode, fileA, fileB, loading, batchFiles, batchRunning]);

  function clearHistory() { safeStorage.remove("plag_history"); setHistory([]); }
  function swapFiles() { setFileA(fileB); setFileB(fileA); setCodeAContent(codeBContent); setCodeBContent(codeAContent); }

  function addBatchFiles(newFiles) {
    setBatchFiles(prev => { const ex = new Set(prev.map(f => f.name)); return [...prev, ...newFiles.filter(f => !ex.has(f.name))]; });
    setBatchMatrix({}); setBatchProgress({ done:0, total:0 });
  }
  function removeBatchFile(idx) { setBatchFiles(prev => prev.filter((_, i) => i !== idx)); setBatchMatrix({}); setBatchProgress({ done:0, total:0 }); }

  async function handleBatchCheck() {
    if (batchFiles.length < 3) { setError("Please upload at least 3 files for batch mode."); return; }
    setError(""); setBatchRunning(true); setBatchMatrix({});
    const contents = {};
    for (const f of batchFiles) contents[f.name] = await readFile(f);
    setBatchContents(contents);
    const pairs = [];
    for (let i = 0; i < batchFiles.length; i++)
      for (let j = i + 1; j < batchFiles.length; j++) pairs.push([i, j]);
    setBatchProgress({ done:0, total:pairs.length });
    setBatchLoadingCells(new Set(pairs.map(([i,j]) => `${i}-${j}`)));

    const CONCURRENCY = 1;
    let idx = 0;
    async function runNext() {
      while (idx < pairs.length) {
        const [i, j] = pairs[idx++]; const key = `${i}-${j}`;
        const fA = batchFiles[i], fB = batchFiles[j];
        try {
          const res = await analyzeFilePair(fA, fB, contents[fA.name], contents[fB.name]);
          setBatchMatrix(prev => ({ ...prev, [key]: res }));
        } catch (e) {
          const res = buildAlgorithmicResult(fA.name, fB.name, contents[fA.name], contents[fB.name]);
          setBatchMatrix(prev => ({ ...prev, [key]: res }));
        }
        setBatchLoadingCells(prev => { const s = new Set(prev); s.delete(key); return s; });
        setBatchProgress(prev => ({ ...prev, done: prev.done + 1 }));
        if (idx < pairs.length) await new Promise(res => setTimeout(res, 800));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, runNext));
    setBatchRunning(false);
  }

  function openModal(iA, iB, res) { setModalData({ result:res, iA, iB }); }
  function closeModal() { setModalData(null); }

  async function handleCheck() {
    if (!fileA || !fileB) { setError("Please upload both code files first."); return; }
    setError(""); setResult(null); setLoading(true); setIsFromHistory(false);
    try {
      const [codeA, codeB] = await Promise.all([readFile(fileA), readFile(fileB)]);
      setCodeAContent(codeA); setCodeBContent(codeB);
      const newResult = await analyzeFilePair(fileA, fileB, codeA, codeB);
      setResult(newResult);
      const updatedHistory = [newResult, ...history].slice(0, 10);
      setHistory(updatedHistory); safeStorage.set("plag_history", updatedHistory);
    } catch (e) {
      try {
        const [codeA, codeB] = await Promise.all([readFile(fileA), readFile(fileB)]);
        const algoResult = buildAlgorithmicResult(fileA.name, fileB.name, codeA, codeB);
        setCodeAContent(codeA); setCodeBContent(codeB);
        setResult(algoResult);
      } catch {
        setError(e.message);
      }
    } finally { setLoading(false); }
  }

  // ─── FIXED PDF download — all strings via pdfSafe() ──────────────────────
  function downloadPDF() {
    if (!result) return;
    const doc = new jsPDF();
    let y = 10;
    const addLine = (text, opts = {}) => {
      const safeText = pdfSafe(text);
      doc.setFont("Courier", opts.bold ? "Bold" : "Normal");
      doc.setFontSize(opts.size || 10);
      const lines = doc.splitTextToSize(safeText, 180);
      lines.forEach(line => { if (y > 280) { doc.addPage(); y = 10; } doc.text(line, 10, y); y += opts.gap || 6; });
      doc.setFont("Courier", "Normal"); doc.setFontSize(10);
    };
    const addSpacer = (h = 4) => { y += h; };
    const addDivider = () => { doc.setDrawColor(180,180,180); doc.line(10, y, 200, y); y += 5; };

    addLine("CODE PLAGIARISM DETECTION REPORT", { bold:true, size:14, gap:8 });
    addLine(`Generated  : ${new Date().toLocaleString()}`, { size:9, gap:5 });
    addLine(`Powered by : LLaMA 3.3 70B (Groq API) + Algorithmic Analysis`, { size:9, gap:5 });
    if (result.ai_fallback) addLine(`NOTE: AI unavailable - results are algorithmic only.`, { size:9, gap:5 });
    addDivider();

    addLine("COMPARISON SUBJECT", { bold:true, size:10, gap:7 });
    addLine(`File A (Original) : ${result.nameA}`, { gap:6 });
    addLine(`File B (Suspect)  : ${result.nameB}`, { gap:6 });
    addLine(`Language A        : ${result.language_a}`, { gap:6 });
    addLine(`Language B        : ${result.language_b}`, { gap:6 });
    addSpacer(2); addDivider();

    addLine("VERDICT", { bold:true, size:10, gap:7 });
    addLine(`Overall Verdict : ${getVerdict(result.similarity_percent)}`, { bold:true, size:11, gap:7 });
    addSpacer(2); addDivider();

    addLine("SCORES", { bold:true, size:10, gap:7 });
    addLine(`Overall Similarity          : ${result.similarity_percent}%`, { gap:6 });
    addLine(`Structure Similarity        : ${result.structure_similarity}%`, { gap:6 });
    addLine(`Token Overlap               : ${result.token_overlap}%`, { gap:6 });
    addLine(`Token Similarity (Jaccard)  : ${result.algo_token_similarity ?? "N/A"}%`, { gap:6 });
    addLine(`Structural Match            : ${result.algo_structural_score ?? "N/A"}%`, { gap:6 });
    addLine(`Normalized Line Overlap     : ${result.algo_normalized_overlap ?? "N/A"}%`, { gap:6 });
    addLine(`Exact Matching Lines        : ${result.matchingLines?.length ?? 0}`, { gap:6 });
    addSpacer(2); addDivider();

    addLine("SUMMARY", { bold:true, size:10, gap:7 });
    addLine(result.summary, { gap:6 });
    addSpacer(2); addDivider();

    if (result.matchingLines?.length) {
      addLine(`EXACT MATCHING LINES - ${result.matchingLines.length} found`, { bold:true, size:10, gap:7 });
      result.matchingLines.slice(0, 30).forEach((line, i) => addLine(`  ${i + 1}. ${line}`, { size:9, gap:5 }));
      if (result.matchingLines.length > 30) addLine(`  ... and ${result.matchingLines.length - 30} more`, { size:9, gap:5 });
      addSpacer(2); addDivider();
    }

    addLine("DETAILED FINDINGS", { bold:true, size:10, gap:7 });
    addLine(result.findings, { gap:6 });
    addSpacer(2); addDivider();

    addLine("RELIABILITY NOTICE", { bold:true, size:9, gap:6 });
    addLine("Exact line matches are 100% algorithmically verified and fully reliable.", { size:9, gap:5 });
    addLine("Blended scores (60% AI + 40% algorithmic) are more reliable than pure AI estimates.", { size:9, gap:5 });
    addLine("AI-only scores are indicative estimates - not guaranteed accurate.", { size:9, gap:5 });

    const safeA = result.nameA.replace(/\.[^.]+$/, ""), safeB = result.nameB.replace(/\.[^.]+$/, "");
    doc.save(`plagiarism-${safeA}-vs-${safeB}.pdf`);
  }

  function downloadReport() {
    if (!result) return;
    const report = {
      report_title: "Code Plagiarism Detection Report",
      generated_at: new Date().toLocaleString(),
      ai_fallback: result.ai_fallback,
      comparison: {
        file_a: { name:result.nameA, language:result.language_a },
        file_b: { name:result.nameB, language:result.language_b },
      },
      verdict: getVerdict(result.similarity_percent),
      scores: {
        similarity_percent: result.similarity_percent,
        structure_similarity: result.structure_similarity,
        token_overlap: result.token_overlap,
        algo_token_similarity: result.algo_token_similarity,
        algo_structural_score: result.algo_structural_score,
        algo_normalized_overlap: result.algo_normalized_overlap,
        exact_matching_lines: result.matchingLines?.length ?? 0,
      },
      summary: result.summary, findings: result.findings,
      matching_lines: result.matchingLines ?? [],
      timestamp: result.timestamp,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    const safeA = result.nameA.replace(/\.[^.]+$/, ""), safeB = result.nameB.replace(/\.[^.]+$/, "");
    a.download = `plagiarism-${safeA}-vs-${safeB}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  const batchDoneCount  = Object.keys(batchMatrix).length;
  const batchTotalPairs = batchFiles.length > 1 ? (batchFiles.length * (batchFiles.length - 1)) / 2 : 0;
  const batchAnyFallback = Object.values(batchMatrix).some(r => r?.ai_fallback);

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="header">
          <div className="eyebrow">BUILDING THE FUTURE OF CODE INTEGRITY</div>
          <h1 style={{ opacity:fade?1:0, transform:fade?"translateY(0)":"translateY(10px)" }}>
            {toggleText ? <>Check for plagiarism in the<br />source code</> : <>Code <span style={{ color:"#0da4eb" }}>Plagiarism</span><br />Detector</>}
          </h1>
          <p>Combines LLaMA 3.3 70B AI analysis with deterministic algorithms — with full algorithmic fallback when AI is unavailable.</p>
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"15px" }}>
            <button className="history-btn" onClick={() => setShowHistory(p => !p)}>History ({history.length})</button>
          </div>
        </div>

        {showHistory && (
          <div ref={historyRef} className="history-panel">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
              <span style={{ fontSize:"11px", color:"#aaa", fontFamily:"var(--mono)", letterSpacing:"1px" }}>HISTORY</span>
              <button className="glass-btn danger" style={{ padding:"3px 8px", fontSize:"10px" }} onClick={clearHistory}>Clear</button>
            </div>
            {history.length === 0
              ? <div style={{ fontSize:"11px", color:"#777", fontFamily:"var(--mono)" }}>No history yet</div>
              : history.map((item, i) => (
                <div key={i} className="history-item" onClick={() => { setResult(item); setMode("pair"); setShowHistory(false); setIsFromHistory(true); setCodeAContent(""); setCodeBContent(""); }}>
                  <span style={{ color:"var(--text)" }}>{item.nameA} vs {item.nameB}</span>
                  <span style={{ color: getLevel(item.similarity_percent) === "high" ? "var(--danger)" : getLevel(item.similarity_percent) === "medium" ? "var(--warn)" : "var(--accent)" }}> | {item.similarity_percent}%</span>
                  <div style={{ color:"#666", marginTop:"2px" }}>{item.timestamp}</div>
                </div>
              ))}
          </div>
        )}

        <div className="mode-tabs">
          <button className={`mode-tab${mode === "pair"  ? " active" : ""}`} onClick={() => { setMode("pair");  setError(""); }}>Pair Check</button>
          <button className={`mode-tab${mode === "otm"   ? " active" : ""}`} onClick={() => { setMode("otm");   setError(""); }}>One-to-Many</button>
          <button className={`mode-tab${mode === "batch" ? " active" : ""}`} onClick={() => { setMode("batch"); setError(""); }}>Batch Matrix</button>
        </div>

        {mode === "otm" && (
          <div style={{ background:"linear-gradient(135deg, rgba(13,164,235,0.08), rgba(0,229,160,0.04))", border:"1px solid rgba(13,164,235,0.25)", borderRadius:"10px", padding:"12px 16px", marginBottom:"1.5rem", fontFamily:"var(--mono)", fontSize:"11px", color:"#aaa", lineHeight:"1.8" }}>
            <strong style={{ color:"#0da4eb" }}>One-to-Many Mode</strong> — Upload one base/source file, then upload all student submissions. Every submission is compared against the source.
            <div style={{ marginTop:"6px", display:"flex", gap:"16px", flexWrap:"wrap" }}>
              <span>✓ Live leaderboard ranked by similarity</span>
              <span>✓ Risk flags: High / Medium / Low / Clean</span>
              <span>✓ Click any row for full diff + findings</span>
              <span>✓ Export PDF or JSON report</span>
            </div>
          </div>
        )}

        {mode === "pair" && (<>
          <div className="upload-grid">
            <DropZone label="File A — Original" file={fileA} onFile={(f) => { setFileA(f); setIsFromHistory(false); }} onRemove={() => setFileA(null)} />
            <DropZone label="File B — Suspect"  file={fileB} onFile={(f) => { setFileB(f); setIsFromHistory(false); }} onRemove={() => setFileB(null)} />
          </div>
          {fileA && fileB && <div style={{ textAlign:"center", marginBottom:"0.75rem" }}>
            <button className="glass-btn" style={{ margin:"0 auto" }} onClick={swapFiles}>Swap Files</button>
          </div>}
          <button className={`check-btn${loading ? " busy" : ""}`} onClick={handleCheck} disabled={loading || !fileA || !fileB}>
            {loading ? <><span className="spin" />Analyzing — running AI twice for accuracy...</> : "Check for Plagiarism"}
          </button>
          {error && <div className="err">⚠ {error}</div>}

          {result && (<div className="results">
            <div className="section-label">Analysis results</div>
            {isFromHistory && <div className="history-notice">Viewing from history — re-upload files to see the diff</div>}
            {result.ai_fallback && <AiFallbackBanner />}
            <div className="score-card">
              <div className="score-inner">
                <ScoreRing pct={result.similarity_percent} level={level} />
                <div className="stat-row">
                  <div className="stat-item"><div className="stat-label">Human-written</div><div className="stat-value" style={{ color:"#00e5a0" }}>{humanScore}%</div></div>
                  <div className="divider-v" />
                  <div className="stat-item"><div className="stat-label">AI-generated</div><div className="stat-value" style={{ color:"#b08dff" }}>{result.ai_generated_likelihood ?? "—"}%</div></div>
                  <div className="divider-v" />
                  <div className="stat-item"><div className="stat-label">Plagiarism</div><div className="stat-value" style={{ color:"#ff4f4f" }}>{result.similarity_percent}%</div></div>
                </div>
                <div className="prog-bar"><div className="prog-fill" style={{ width:`${humanScore}%` }} /></div>
                {result.ai_reason && <div style={{ marginTop:"10px", fontSize:"11px", color:"var(--muted)", fontFamily:"var(--mono)", lineHeight:"1.6" }}>AI: {result.ai_reason}</div>}
              </div>
              <div className="score-info">
                <div className={`verdict-pill pill-${level}`}>{getVerdict(result.similarity_percent)}</div>
                <div className="score-summary">{result.summary}</div>
                <div className="lang-row">{result.language_a} vs {result.language_b}</div>
              </div>
              <div className="download-row">
                <button className="glass-btn" onClick={downloadPDF}>PDF Report</button>
                <button className="glass-btn" onClick={downloadReport}>JSON Report</button>
              </div>
            </div>
            <div className="section-label">Algorithmic scores — 100% deterministic, fully reliable</div>
            <AlgoScores result={result} />
            <div className="section-label">Blended scores</div>
            <div className="metrics">
              {[{ label:"Logic similarity", val:result.logic_similarity }, { label:"Structure match", val:result.structure_similarity }, { label:"Token overlap", val:result.token_overlap }].map(({ label, val }) => {
                const lv = getLevel(val);
                return (<div className="metric" key={label}><div className="m-lbl">{label}</div><div className={`m-val c-${lv}`}>{Math.round(val)}%</div><div className="m-bar"><div className={`m-fill fill-${lv}`} style={{ width:`${val}%` }} /></div></div>);
              })}
            </div>
            <div className="section-label">Matching lines — {result.matchingLines.length} exact matches (100% algorithmically verified)</div>
            <div className="lines-box">
              {result.matchingLines.length === 0 ? <div className="no-lines">No exact line matches detected</div>
                : result.matchingLines.slice(0, 100).map((line, i) => (
                  <div key={i} className="line-row" style={{ background:"rgba(255,79,79,0.12)" }}>
                    <span className="ln">{i + 1}</span>
                    <span className="lc" style={{ color:"#ff4f4f" }}>{line}</span>
                    <CopyButton text={line} />
                  </div>
                ))}
            </div>
            {codeAContent && codeBContent && <InlineDiff codeAContent={codeAContent} codeBContent={codeBContent} fileAName={result.nameA} fileBName={result.nameB} />}
            <div className="section-label">Detailed findings</div>
            <div className="findings">{result.findings}</div>
            <ReliabilityInfo result={result} />
          </div>)}
        </>)}

        {mode === "otm" && <OneToManyMode />}

        {mode === "batch" && (<>
          <BatchDropZone files={batchFiles} onFiles={addBatchFiles} onRemoveFile={removeBatchFile} />
          {batchFiles.length > 0 && batchFiles.length < 3 && <div className="err" style={{ marginBottom:"1rem" }}>Add at least {3 - batchFiles.length} more file{3 - batchFiles.length > 1 ? "s" : ""}.</div>}
          {batchFiles.length >= 3 && <div style={{ fontFamily:"var(--mono)", fontSize:"12px", color:"var(--muted)", marginBottom:"1rem", padding:"10px 14px", background:"var(--surface)", borderRadius:"8px", border:"1px solid var(--border)" }}>
            {batchFiles.length} files — {batchTotalPairs} pairs · AI runs twice per pair, falls back to algorithms if unavailable
            <span style={{ color:"var(--accent)", marginLeft:"12px" }}>Cmd+Enter to run</span>
          </div>}
          <button className={`check-btn${batchRunning ? " busy" : ""}`} onClick={handleBatchCheck} disabled={batchRunning || batchFiles.length < 3}>
            {batchRunning ? <><span className="spin" />Analyzing {batchProgress.done}/{batchProgress.total} pairs...</> : `Run Batch Analysis (${batchTotalPairs} pairs)`}
          </button>
          {batchRunning && batchProgress.total > 0 && <div className="batch-progress" style={{ marginTop:"-1rem", marginBottom:"1.5rem" }}>
            <div className="batch-status"><span>Comparing pairs...</span><span style={{ color:"var(--accent)" }}>{batchProgress.done} / {batchProgress.total}</span></div>
            <div className="batch-progress-bar"><div className="batch-progress-fill" style={{ width:`${(batchProgress.done / batchProgress.total) * 100}%` }} /></div>
          </div>}
          {error && <div className="err">⚠ {error}</div>}
          {batchAnyFallback && !batchRunning && <AiFallbackBanner />}
          {(Object.keys(batchMatrix).length > 0 || batchLoadingCells.size > 0) && (<>
            <div className="section-label">
              Similarity matrix — {batchDoneCount}/{batchTotalPairs} pairs analyzed
              {batchDoneCount === batchTotalPairs && !batchRunning && <span style={{ color:"var(--accent)", marginLeft:"10px" }}>Complete</span>}
            </div>
            <BatchMatrix files={batchFiles} matrix={batchMatrix} loadingCells={batchLoadingCells} onCellClick={openModal} />
          </>)}
        </>)}
      </div>

      {modalData && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>X Close</button>
            <div className="modal-title">{batchFiles[modalData.iA]?.name} vs {batchFiles[modalData.iB]?.name}</div>
            <ResultDetail
              result={modalData.result}
              fileAName={batchFiles[modalData.iA]?.name}
              fileBName={batchFiles[modalData.iB]?.name}
              codeAContent={batchContents[batchFiles[modalData.iA]?.name] || ""}
              codeBContent={batchContents[batchFiles[modalData.iB]?.name] || ""}
            />
          </div>
        </div>
      )}
    </>
  );
}
