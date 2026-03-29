import { jsPDF } from "jspdf";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";

// ─── File reader ──────────────────────────────────────────────────────────────
const readFile = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsText(file);
  });

// ─── IMPROVEMENT 1: Normalize code before comparison ─────────────────────────
function normalizeCode(code) {
  return code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/#.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ─── IMPROVEMENT 2: Enhanced matching ────────────────────────────────────────
function getMatchingLines(codeA, codeB) {
  const rawA = codeA.split("\n").map(l => l.trim()).filter(l => l.length > 4);
  const rawB = new Set(codeB.split("\n").map(l => l.trim()).filter(l => l.length > 4));
  return rawA.filter(l => rawB.has(l));
}

function getNormalizedOverlapPct(codeA, codeB) {
  const normA = codeA.split("\n").map(l => normalizeCode(l)).filter(l => l.length > 3);
  const normB = new Set(codeB.split("\n").map(l => normalizeCode(l)).filter(l => l.length > 3));
  if (!normA.length) return 0;
  const matches = normA.filter(l => normB.has(l)).length;
  return Math.round((matches / normA.length) * 100);
}

// ─── IMPROVEMENT 3: Jaccard token similarity ─────────────────────────────────
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

// ─── IMPROVEMENT 4: Structural fingerprint ───────────────────────────────────
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
  js:    { label: "JavaScript", emoji: "🟨" },
  jsx:   { label: "React/JSX",  emoji: "⚛️" },
  ts:    { label: "TypeScript", emoji: "🔷" },
  tsx:   { label: "React/TSX",  emoji: "⚛️" },
  py:    { label: "Python",     emoji: "🐍" },
  java:  { label: "Java",       emoji: "☕" },
  c:     { label: "C",          emoji: "⚙️" },
  cpp:   { label: "C++",        emoji: "⚙️" },
  cs:    { label: "C#",         emoji: "🟣" },
  go:    { label: "Go",         emoji: "🐹" },
  rs:    { label: "Rust",       emoji: "🦀" },
  rb:    { label: "Ruby",       emoji: "💎" },
  php:   { label: "PHP",        emoji: "🐘" },
  swift: { label: "Swift",      emoji: "🍎" },
  kt:    { label: "Kotlin",     emoji: "🎯" },
  html:  { label: "HTML",       emoji: "🌐" },
  css:   { label: "CSS",        emoji: "🎨" },
  txt:   { label: "Text",       emoji: "📄" },
};

function detectLanguage(file) {
  if (!file) return null;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return LANG_MAP[ext] || { label: ext?.toUpperCase() || "Unknown", emoji: "📄" };
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
      diffA.unshift({ type:"same",    line:a[i-1] }); diffB.unshift({ type:"same",  line:b[j-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      diffB.unshift({ type:"added",   line:b[j-1] }); diffA.unshift({ type:"empty", line:"" }); j--;
    } else {
      diffA.unshift({ type:"removed", line:a[i-1] }); diffB.unshift({ type:"empty", line:"" }); i--;
    }
  }
  return { diffA, diffB };
}

const safeStorage = {
  get:    (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  remove: (k) => { try { localStorage.removeItem(k); } catch {} },
};

async function callGroqAPI(payload) {
  const resp = await fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `Groq API error ${resp.status}`);
  return data.choices?.[0]?.message?.content || "";
}

// ─── IMPROVEMENT 5: Double AI run, averaged scores ────────────────────────────
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
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return ONLY valid JSON. No text, no markdown. Be consistent." },
      { role: "user", content: prompt },
    ],
  };
  return JSON.parse(await callGroqAPI(payload));
}

async function analyzeFilePair(fileA, fileB, codeA, codeB) {
  let run1 = null, run2 = null;
  try { run1 = await callGroqOnce(fileA.name, fileB.name, codeA, codeB); } catch {}
  try { run2 = await callGroqOnce(fileA.name, fileB.name, codeA, codeB); } catch {}
  if (!run1 && !run2) throw new Error("AI analysis failed on both attempts. Check your API connection.");

  const avg = (key) => {
    const vals = [run1, run2].filter(Boolean).map(r => Number(r[key]) || 0);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  const base = run1 || run2;

  const algoTokenSim    = getTokenSimilarity(codeA, codeB);
  const algoStructSim   = getStructuralScore(codeA, codeB);
  const algoNormOverlap = getNormalizedOverlapPct(codeA, codeB);

  // 60% AI + 40% algorithmic blend
  const blendedSimilarity   = Math.round(avg("similarity_percent")  * 0.6 + algoNormOverlap * 0.4);
  const blendedTokenOverlap = Math.round(avg("token_overlap")        * 0.6 + algoTokenSim    * 0.4);
  const blendedStructure    = Math.round(avg("structure_similarity") * 0.6 + algoStructSim   * 0.4);

  const matchingLines = getMatchingLines(codeA, codeB);

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
`;

function DropZone({ label, file, onFile, onRemove }) {
  const [drag, setDrag] = useState(false);
  const lang = detectLanguage(file);
  const onDrop = useCallback((e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }, [onFile]);
  return (
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
          <span className="lang-badge"><span>{lang.emoji}</span><span>{lang.label}</span></span>
        </div>}
      </>) : <div className="dz-hint">click or drag & drop</div>}
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
          <span>{lang?.emoji}</span>
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
              <span className="diff-ln">{row.type !== "empty" ? i + 1 : ""}</span>
              <span className="diff-sign">{row.type === "removed" ? "−" : " "}</span>
              <span className="diff-text">{row.line}</span>
            </div>
          ))}
        </div>
        <div className="diff-col">
          {diff.diffB.map((row, i) => (
            <div key={i} className={`diff-line ${row.type}`}>
              <span className="diff-ln">{row.type !== "empty" ? i + 1 : ""}</span>
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
        <div className="diff-note">⚠ Diff view limited to 400 lines. Full analysis ran on the complete file.</div>}
    </div>}
  </>);
}

function ReliabilityInfo({ result }) {
  return (
    <div className="reliability-note">
      <div style={{ marginBottom:"6px", color:"var(--text)", fontWeight:"600" }}>How these scores were calculated</div>
      <div><span className="tag tag-verified">✓ VERIFIED</span> Exact matching lines — pure string algorithm, 100% accurate</div>
      <div><span className="tag tag-verified">✓ VERIFIED</span> Code diff view — LCS algorithm (same as Git), 100% accurate</div>
      <div><span className="tag tag-verified">✓ VERIFIED</span> Algorithmic scores (token sim, structural, normalized) — 100% deterministic</div>
      <div><span className="tag tag-blended">⚡ BLENDED</span> Similarity % — 60% AI + 40% normalized line overlap</div>
      <div><span className="tag tag-blended">⚡ BLENDED</span> Token overlap — 60% AI + 40% Jaccard token similarity</div>
      <div><span className="tag tag-blended">⚡ BLENDED</span> Structure match — 60% AI + 40% function/class name overlap</div>
      <div><span className="tag tag-ai">🤖 AI-ESTIMATED</span> Logic similarity, Human score, AI-generated likelihood — indicative only</div>
      {result.ai_run_count === 2 && <div style={{ marginTop:"6px", color:"var(--accent)" }}>✓ AI ran twice and scores were averaged for consistency (LLaMA 3.3 70B via Groq)</div>}
      {result.ai_run_count === 1 && <div style={{ marginTop:"6px", color:"var(--warn)" }}>⚠ One AI run succeeded — scores may be slightly less consistent</div>}
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
        {result.ai_reason && <div style={{ marginTop:"10px", fontSize:"11px", color:"var(--muted)", fontFamily:"var(--mono)", lineHeight:"1.6" }}>🤖 {result.ai_reason}</div>}
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

    <div className="trust-banner" style={{ marginTop:"1.25rem" }}>
      <strong>How results are produced</strong> — hybrid approach for maximum reliability:
      <div className="trust-row">
        <div className="trust-item"><div className="trust-dot" style={{ background:"#00e5a0" }} />Exact line matching — 100% algorithmic, fully reliable</div>
        <div className="trust-item"><div className="trust-dot" style={{ background:"#00e5a0" }} />Code diff — LCS algorithm (same as Git), fully reliable</div>
        <div className="trust-item"><div className="trust-dot" style={{ background:"#f5a623" }} />Similarity scores — blended: LLaMA 3.3 70B (×2, averaged) + algorithms</div>
        <div className="trust-item"><div className="trust-dot" style={{ background:"#b08dff" }} />Logic/human/AI scores — AI estimates, indicative only</div>
      </div>
    </div>

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
                  <span style={{ fontSize:"14px" }}>{lang?.emoji}</span><span>{shortName(f)}</span>
                </div>
              </th>
            ); })}
          </tr>
        </thead>
        <tbody>
          {files.map((fRow, i) => { const langRow = detectLanguage(fRow); return (
            <tr key={i}>
              <td className="matrix-row-label" title={fRow.name}><span style={{ marginRight:"6px" }}>{langRow?.emoji}</span>{shortName(fRow)}</td>
              {files.map((fCol, j) => {
                if (i === j) return (<td key={j}><div className="matrix-cell self" style={{ background:"rgba(255,255,255,0.03)" }}><span style={{ color:"var(--muted)", fontSize:"18px" }}>—</span></div></td>);
                const key = `${Math.min(i,j)}-${Math.max(i,j)}`;
                const res = matrix[key]; const isLoading = loadingCells.has(key);
                if (isLoading) return (<td key={j}><div className="matrix-cell" style={{ background:"rgba(255,255,255,0.04)" }}><div className="matrix-loading"><div className="matrix-spinner" /></div></div></td>);
                if (!res) return (<td key={j}><div className="matrix-cell" style={{ background:"rgba(255,255,255,0.02)" }}><span style={{ color:"var(--muted)", fontSize:"11px", fontFamily:"var(--mono)" }}>–</span></div></td>);
                const pct = res.similarity_percent; const textColor = heatTextColor(pct);
                return (<td key={j}><div className="matrix-cell" style={{ background:heatColor(pct) }} onClick={() => onCellClick(i, j, res)} title={`${fRow.name} vs ${fCol.name}: ${pct}%`}>
                  <span className="matrix-pct" style={{ color:textColor }}>{pct}%</span>
                  <span className="matrix-verdict" style={{ color:textColor }}>{getVerdict(pct)}</span>
                </div></td>);
              })}
            </tr>
          ); })}
        </tbody>
      </table>
      <div className="matrix-legend">
        <div className="matrix-legend-item"><div className="matrix-legend-dot" style={{ background:"rgba(255,79,79,0.5)" }} />&ge;70% — Definite Plagiarism</div>
        <div className="matrix-legend-item"><div className="matrix-legend-dot" style={{ background:"rgba(245,166,35,0.5)" }} />40–69% — Likely Plagiarized</div>
        <div className="matrix-legend-item"><div className="matrix-legend-dot" style={{ background:"rgba(128,216,255,0.4)" }} />15–39% — Suspicious</div>
        <div className="matrix-legend-item"><div className="matrix-legend-dot" style={{ background:"rgba(0,229,160,0.3)" }} />&lt;15% — Original</div>
        <div className="matrix-legend-item" style={{ marginLeft:"auto", color:"var(--accent)" }}>Click any cell to view full diff →</div>
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode]               = useState("pair");
  const [fileA, setFileA]             = useState(null);
  const [fileB, setFileB]             = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [result, setResult]           = useState(null);
  const [codeAContent, setCodeAContent] = useState("");
  const [codeBContent, setCodeBContent] = useState("");
  const [isFromHistory, setIsFromHistory] = useState(false);
  const [batchFiles, setBatchFiles]   = useState([]);
  const [batchMatrix, setBatchMatrix] = useState({});
  const [batchLoadingCells, setBatchLoadingCells] = useState(new Set());
  const [batchProgress, setBatchProgress] = useState({ done:0, total:0 });
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchContents, setBatchContents] = useState({});
  const [modalData, setModalData]     = useState(null);
  const [history, setHistory]         = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [toggleText, setToggleText]   = useState(true);
  const [fade, setFade]               = useState(true);
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
    const CONCURRENCY = 2;
    let idx = 0;
    async function runNext() {
      while (idx < pairs.length) {
        const [i, j] = pairs[idx++]; const key = `${i}-${j}`;
        const fA = batchFiles[i], fB = batchFiles[j];
        try {
          const res = await analyzeFilePair(fA, fB, contents[fA.name], contents[fB.name]);
          setBatchMatrix(prev => ({ ...prev, [key]: res }));
        } catch (e) {
          setBatchMatrix(prev => ({ ...prev, [key]: { similarity_percent:0, error:e.message, nameA:fA.name, nameB:fB.name, matchingLines:[], algo_token_similarity:0, algo_structural_score:0, algo_normalized_overlap:0, ai_run_count:0 } }));
        }
        setBatchLoadingCells(prev => { const s = new Set(prev); s.delete(key); return s; });
        setBatchProgress(prev => ({ ...prev, done: prev.done + 1 }));
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
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  function downloadPDF() {
    if (!result) return;
    const doc = new jsPDF();
    let y = 10;
    const addLine = (text, opts = {}) => {
      doc.setFont("Courier", opts.bold ? "Bold" : "Normal");
      doc.setFontSize(opts.size || 10);
      const lines = doc.splitTextToSize(String(text), 180);
      lines.forEach(line => { if (y > 280) { doc.addPage(); y = 10; } doc.text(line, 10, y); y += opts.gap || 6; });
      doc.setFont("Courier", "Normal"); doc.setFontSize(10);
    };
    const addSpacer = (h = 4) => { y += h; };
    const addDivider = () => { doc.setDrawColor(180,180,180); doc.line(10, y, 200, y); y += 5; };

    addLine("CODE PLAGIARISM DETECTION REPORT", { bold:true, size:14, gap:8 });
    addLine(`Generated  : ${new Date().toLocaleString()}`, { size:9, gap:5 });
    addLine(`Powered by : LLaMA 3.3 70B (Groq API) + Algorithmic Analysis`, { size:9, gap:5 });
    addDivider();

    addLine("COMPARISON SUBJECT", { bold:true, size:10, gap:7 });
    addLine(`Comparison result for "${result.nameA}" and "${result.nameB}" are as follows:`, { size:10, gap:7 });
    addLine(`File A (Original) : ${result.nameA}`, { gap:6 });
    addLine(`File B (Suspect)  : ${result.nameB}`, { gap:6 });
    addLine(`Language A        : ${result.language_a}`, { gap:6 });
    addLine(`Language B        : ${result.language_b}`, { gap:6 });
    addSpacer(2); addDivider();

    addLine("VERDICT", { bold:true, size:10, gap:7 });
    addLine(`Overall Verdict : ${getVerdict(result.similarity_percent)}`, { bold:true, size:11, gap:7 });
    addSpacer(2); addDivider();

    addLine("BLENDED SCORES (60% AI + 40% Algorithmic)", { bold:true, size:10, gap:7 });
    addLine(`Overall Similarity   : ${result.similarity_percent}%`, { gap:6 });
    addLine(`Structure Similarity : ${result.structure_similarity}%`, { gap:6 });
    addLine(`Token Overlap        : ${result.token_overlap}%`, { gap:6 });
    addSpacer(2); addDivider();

    addLine("ALGORITHMIC SCORES (100% Deterministic — Fully Reliable)", { bold:true, size:10, gap:7 });
    addLine(`Token Similarity (Jaccard)     : ${result.algo_token_similarity ?? "N/A"}%`, { gap:6 });
    addLine(`Structural Match (func names)  : ${result.algo_structural_score ?? "N/A"}%`, { gap:6 });
    addLine(`Normalized Line Overlap        : ${result.algo_normalized_overlap ?? "N/A"}%`, { gap:6 });
    addLine(`Exact Matching Lines           : ${result.matchingLines?.length ?? 0}`, { gap:6 });
    addSpacer(2); addDivider();

    addLine("AI-ESTIMATED SCORES (Indicative Only)", { bold:true, size:10, gap:7 });
    addLine(`Logic Similarity        : ${result.logic_similarity}%`, { gap:6 });
    addLine(`Human-Written Score     : ${result.human_score ?? (100 - result.similarity_percent)}%`, { gap:6 });
    addLine(`AI-Generated Likelihood : ${result.ai_generated_likelihood ?? "N/A"}%`, { gap:6 });
    addLine(`AI Analysis Runs        : ${result.ai_run_count ?? 1} (averaged for consistency)`, { gap:6 });
    if (result.ai_reason) { addSpacer(2); addLine(`AI Note: ${result.ai_reason}`, { size:9, gap:6 }); }
    addSpacer(2); addDivider();

    addLine("SUMMARY", { bold:true, size:10, gap:7 });
    addLine(result.summary, { gap:6 });
    addSpacer(2); addDivider();

    if (result.matchingLines?.length) {
      addLine(`EXACT MATCHING LINES — ${result.matchingLines.length} found (algorithmically verified)`, { bold:true, size:10, gap:7 });
      result.matchingLines.slice(0, 30).forEach((line, i) => addLine(`  ${i + 1}. ${line}`, { size:9, gap:5 }));
      if (result.matchingLines.length > 30) addLine(`  ... and ${result.matchingLines.length - 30} more`, { size:9, gap:5 });
      addSpacer(2); addDivider();
    }

    addLine("DETAILED FINDINGS", { bold:true, size:10, gap:7 });
    addLine(result.findings, { gap:6 });
    addSpacer(4); addDivider();

    addLine("RELIABILITY NOTICE", { bold:true, size:9, gap:6 });
    addLine("Exact line matches and diff are 100% algorithmically verified and fully reliable.", { size:9, gap:5 });
    addLine("Blended scores (60% AI + 40% algorithmic) are more reliable than pure AI estimates.", { size:9, gap:5 });
    addLine("AI-only scores are indicative estimates — not guaranteed accurate.", { size:9, gap:5 });
    addLine("Recommended use: screening tool. Human review advised for formal/legal decisions.", { size:9, gap:5 });

    const safeA = result.nameA.replace(/\.[^.]+$/, ""), safeB = result.nameB.replace(/\.[^.]+$/, "");
    doc.save(`plagiarism-${safeA}-vs-${safeB}.pdf`);
  }

  function downloadReport() {
    if (!result) return;
    const report = {
      report_title: "Code Plagiarism Detection Report",
      generated_at: new Date().toLocaleString(),
      powered_by: "LLaMA 3.3 70B (Groq API) + Algorithmic Analysis",
      comparison: {
        description: `Comparison result for "${result.nameA}" and "${result.nameB}" are as follows:`,
        file_a: { name:result.nameA, role:"Original", language:result.language_a },
        file_b: { name:result.nameB, role:"Suspect",  language:result.language_b },
      },
      verdict: getVerdict(result.similarity_percent),
      blended_scores: {
        note: "60% AI + 40% algorithmic — more reliable than pure AI",
        overall_similarity_percent:   result.similarity_percent,
        structure_similarity_percent: result.structure_similarity,
        token_overlap_percent:        result.token_overlap,
      },
      algorithmic_scores: {
        note: "100% deterministic — fully reliable",
        token_similarity_jaccard_percent: result.algo_token_similarity,
        structural_match_percent:         result.algo_structural_score,
        normalized_line_overlap_percent:  result.algo_normalized_overlap,
        exact_matching_lines_count:       result.matchingLines?.length ?? 0,
      },
      ai_estimated_scores: {
        note: "AI-estimated — indicative only",
        logic_similarity_percent:          result.logic_similarity,
        human_written_percent:             result.human_score ?? (100 - result.similarity_percent),
        ai_generated_likelihood_percent:   result.ai_generated_likelihood ?? null,
        ai_run_count:                      result.ai_run_count ?? 1,
        ai_model:                          "LLaMA 3.3 70B via Groq API",
      },
      ai_detection_note: result.ai_reason || null,
      summary:  result.summary,
      findings: result.findings,
      matching_lines: {
        count: result.matchingLines?.length ?? 0,
        reliability: "100% algorithmically verified — exact string match",
        lines: result.matchingLines ?? [],
      },
      reliability_notice: "Exact line matches are 100% reliable. Blended scores are more reliable than pure AI. AI-only scores are estimates. Use as a screening tool; human review recommended for formal decisions.",
      timestamp: result.timestamp,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeA = result.nameA.replace(/\.[^.]+$/, ""), safeB = result.nameB.replace(/\.[^.]+$/, "");
    a.download = `plagiarism-${safeA}-vs-${safeB}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  const batchDoneCount = Object.keys(batchMatrix).length;
  const batchTotalPairs = batchFiles.length > 1 ? (batchFiles.length * (batchFiles.length - 1)) / 2 : 0;

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="header">
          <div className="eyebrow">BUILDING THE FUTURE OF CODE INTEGRITY</div>
          <h1 style={{ opacity:fade?1:0, transform:fade?"translateY(0)":"translateY(10px)" }}>
            {toggleText ? <>Check for plagiarism in the<br />source code</> : <>Code <span style={{ color:"#0da4eb" }}>Plagiarism</span><br />Detector</>}
          </h1>
          <p>Combines LLaMA 3.3 70B AI analysis (run twice, averaged) with deterministic algorithms — for results you can trust and rely onto.</p>
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"15px" }}>
            <button className="history-btn" onClick={() => setShowHistory(p => !p)}>📜 History ({history.length})</button>
          </div>
        </div>

        {showHistory && (
          <div ref={historyRef} className="history-panel">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
              <span style={{ fontSize:"11px", color:"#aaa", fontFamily:"var(--mono)", letterSpacing:"1px" }}>HISTORY</span>
              <button className="glass-btn danger" style={{ padding:"3px 8px", fontSize:"10px" }} onClick={clearHistory}>Clear</button>
            </div>
            {history.length === 0 ? <div style={{ fontSize:"11px", color:"#777", fontFamily:"var(--mono)" }}>No history yet</div>
              : history.map((item, i) => (
                <div key={i} className="history-item" onClick={() => { setResult(item); setMode("pair"); setShowHistory(false); setIsFromHistory(true); setCodeAContent(""); setCodeBContent(""); }}>
                  <span style={{ color:"var(--text)" }}>{item.nameA} ↔ {item.nameB}</span>
                  <span style={{ color: getLevel(item.similarity_percent) === "high" ? "var(--danger)" : getLevel(item.similarity_percent) === "medium" ? "var(--warn)" : "var(--accent)" }}> | {item.similarity_percent}%</span>
                  <div style={{ color:"#666", marginTop:"2px" }}>{item.timestamp}</div>
                </div>
              ))}
          </div>
        )}

        <div className="mode-tabs">
          <button className={`mode-tab${mode === "pair" ? " active" : ""}`} onClick={() => { setMode("pair"); setError(""); }}>⇄ Pair Check</button>
          <button className={`mode-tab${mode === "batch" ? " active" : ""}`} onClick={() => { setMode("batch"); setError(""); }}>📊 Batch Mode — Class Checker</button>
        </div>

        {mode === "pair" && (<>
          <div className="upload-grid">
            <DropZone label="File A — Original" file={fileA} onFile={(f) => { setFileA(f); setIsFromHistory(false); }} onRemove={() => setFileA(null)} />
            <DropZone label="File B — Suspect"  file={fileB} onFile={(f) => { setFileB(f); setIsFromHistory(false); }} onRemove={() => setFileB(null)} />
          </div>
          {fileA && fileB && <div style={{ textAlign:"center", marginBottom:"0.75rem" }}>
            <button className="glass-btn" style={{ margin:"0 auto" }} onClick={swapFiles}>⇄ Swap Files</button>
          </div>}
          <button className={`check-btn${loading ? " busy" : ""}`} onClick={handleCheck} disabled={loading || !fileA || !fileB}>
            {loading ? <><span className="spin" />Analyzing — running AI twice for accuracy...</> : "→ Check for Plagiarism"}
          </button>
          {error && <div className="err">⚠ {error}</div>}

          {result && (<div className="results">
            <div className="section-label">Analysis results</div>
            {isFromHistory && <div className="history-notice">📜 Viewing from history — re-upload files to see the diff</div>}
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
                {result.ai_reason && <div style={{ marginTop:"10px", fontSize:"11px", color:"var(--muted)", fontFamily:"var(--mono)", lineHeight:"1.6" }}>🤖 {result.ai_reason}</div>}
              </div>
              <div className="score-info">
                <div className={`verdict-pill pill-${level}`}>{getVerdict(result.similarity_percent)}</div>
                <div className="score-summary">{result.summary}</div>
                <div className="lang-row">{result.language_a} → {result.language_b}</div>
              </div>
              <div className="download-row">
                <button className="glass-btn" onClick={downloadPDF}>📄 PDF Report</button>
                <button className="glass-btn" onClick={downloadReport}>⬇ JSON Report</button>
              </div>
            </div>

            <div className="section-label">Algorithmic scores — 100% deterministic, fully reliable</div>
            <AlgoScores result={result} />

            <div className="section-label">Blended scores — AI + algorithmic</div>
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

            <div className="trust-banner" style={{ marginTop:"1.25rem" }}>
              <strong>How results are produced</strong> — hybrid approach for maximum reliability:
              <div className="trust-row">
                <div className="trust-item"><div className="trust-dot" style={{ background:"#00e5a0" }} />Exact line matching — 100% algorithmic, fully reliable</div>
                <div className="trust-item"><div className="trust-dot" style={{ background:"#00e5a0" }} />Code diff — LCS algorithm (same as Git), fully reliable</div>
                <div className="trust-item"><div className="trust-dot" style={{ background:"#f5a623" }} />Similarity scores — blended: LLaMA 3.3 70B (×2, averaged) + algorithms</div>
                <div className="trust-item"><div className="trust-dot" style={{ background:"#b08dff" }} />Logic/human/AI scores — AI estimates, indicative only</div>
              </div>
            </div>

            <ReliabilityInfo result={result} />
          </div>)}
        </>)}

        {mode === "batch" && (<>
          <BatchDropZone files={batchFiles} onFiles={addBatchFiles} onRemoveFile={removeBatchFile} />
          {batchFiles.length > 0 && batchFiles.length < 3 && <div className="err" style={{ marginBottom:"1rem" }}>⚠ Add at least {3 - batchFiles.length} more file{3 - batchFiles.length > 1 ? "s" : ""}.</div>}
          {batchFiles.length >= 3 && <div style={{ fontFamily:"var(--mono)", fontSize:"12px", color:"var(--muted)", marginBottom:"1rem", padding:"10px 14px", background:"var(--surface)", borderRadius:"8px", border:"1px solid var(--border)" }}>
            📊 {batchFiles.length} files → {batchTotalPairs} pairs · AI runs twice per pair for reliability
            <span style={{ color:"var(--accent)", marginLeft:"12px" }}>Cmd+Enter to run</span>
          </div>}
          <button className={`check-btn${batchRunning ? " busy" : ""}`} onClick={handleBatchCheck} disabled={batchRunning || batchFiles.length < 3}>
            {batchRunning ? <><span className="spin" />Analyzing {batchProgress.done}/{batchProgress.total} pairs...</> : `→ Run Batch Analysis (${batchTotalPairs} pairs)`}
          </button>
          {batchRunning && batchProgress.total > 0 && <div className="batch-progress" style={{ marginTop:"-1rem", marginBottom:"1.5rem" }}>
            <div className="batch-status"><span>Comparing pairs...</span><span style={{ color:"var(--accent)" }}>{batchProgress.done} / {batchProgress.total}</span></div>
            <div className="batch-progress-bar"><div className="batch-progress-fill" style={{ width:`${(batchProgress.done / batchProgress.total) * 100}%` }} /></div>
          </div>}
          {error && <div className="err">⚠ {error}</div>}
          {(Object.keys(batchMatrix).length > 0 || batchLoadingCells.size > 0) && (<>
            <div className="section-label">
              Similarity matrix — {batchDoneCount}/{batchTotalPairs} pairs analyzed
              {batchDoneCount === batchTotalPairs && !batchRunning && <span style={{ color:"var(--accent)", marginLeft:"10px" }}>✓ Complete</span>}
            </div>
            <BatchMatrix files={batchFiles} matrix={batchMatrix} loadingCells={batchLoadingCells} onCellClick={openModal} />
          </>)}
        </>)}
      </div>

      {modalData && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>✕ Close</button>
            <div className="modal-title">📄 {batchFiles[modalData.iA]?.name} ↔ 📄 {batchFiles[modalData.iB]?.name}</div>
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
