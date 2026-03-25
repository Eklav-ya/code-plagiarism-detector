import { jsPDF } from "jspdf";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";

const readFile = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsText(file);
  });

function getMatchingLines(codeA, codeB) {
  const linesA = codeA.split("\n").map((l) => l.trim()).filter((l) => l.length > 4);
  const setB = new Set(codeB.split("\n").map((l) => l.trim()).filter((l) => l.length > 4));
  return linesA.filter((l) => setB.has(l));
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

// Safe localStorage wrapper (fixes Safari private mode crash)
const safeStorage = {
  get: (key) => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set: (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
  remove: (key) => {
    try { localStorage.removeItem(key); } catch {}
  },
};

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
  body {
    background: radial-gradient(circle at 20% 20%, rgba(130,80,255,0.25), transparent 40%),
                radial-gradient(circle at 80% 30%, rgba(0,229,160,0.15), transparent 40%),
                radial-gradient(circle at 50% 80%, rgba(180,120,255,0.2), transparent 50%),
                #0a0a0f;
    color: var(--text);
    font-family: var(--sans);
    min-height: 100vh;
  }
  .app { max-width: 980px; margin: 0 auto; padding: 3rem 1.5rem 5rem; animation: fadeUp 0.5s ease both; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }

  .header { margin-bottom: 2.5rem; text-align: center; }
  .eyebrow { font-size: 11px; letter-spacing: 2px; color: #888; font-family: var(--mono); margin-bottom: 12px; text-transform: uppercase; }
  .header h1 { font-size: clamp(2.5rem,6vw,3.5rem); font-weight:700; line-height:1.2; letter-spacing:-1px; color:#fff; margin-bottom:16px; transition: opacity 0.4s ease, transform 0.4s ease; }
  .header p { max-width:700px; margin:0 auto; font-size:15px; color:#aaa; line-height:1.8; font-family:var(--sans); }

  /* THRESHOLD SLIDER */
  .slider-row { display:flex; align-items:center; gap:12px; margin-bottom:1rem; padding:12px 16px; background:var(--surface); border:1px solid var(--border); border-radius:10px; font-family:var(--mono); font-size:12px; color:var(--muted); flex-wrap:wrap; }
  .slider-row label { white-space:nowrap; }
  .slider-row input[type=range] { flex:1; accent-color: var(--accent); cursor:pointer; min-width:80px; }
  .slider-val { color:var(--accent); font-weight:600; min-width:30px; text-align:right; }
  .toggle-wrap { display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; }
  .toggle-track { width:34px; height:18px; border-radius:9px; background:var(--border2); position:relative; transition:background 0.2s; flex-shrink:0; }
  .toggle-track.on { background:var(--accent2); }
  .toggle-thumb { position:absolute; top:3px; left:3px; width:12px; height:12px; border-radius:50%; background:#fff; transition:transform 0.2s; }
  .toggle-track.on .toggle-thumb { transform:translateX(16px); }
  .slider-disabled { opacity:0.35; pointer-events:none; }

  /* UPLOAD GRID */
  .upload-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:1rem; }
  @media(max-width:600px) { .upload-grid { grid-template-columns:1fr; } }

  .drop-zone {
    border:1.5px dashed var(--border2); border-radius:12px; padding:2rem 1.5rem;
    text-align:center; cursor:pointer; background:rgba(20,20,30,0.6);
    backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.08);
    position:relative; transition:border-color 0.2s, background 0.2s;
  }
  .drop-zone:hover, .drop-zone.drag { border-color:var(--accent); background:rgba(0,229,160,0.04); }
  .drop-zone.filled { border-style:solid; border-color:var(--accent2); background:rgba(0,179,122,0.05); }
  .drop-zone input { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
  .dz-icon { font-size:26px; display:block; margin-bottom:8px; line-height:1; }
  .dz-label { font-size:11px; font-family:var(--mono); color:var(--muted); letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
  .dz-name { font-size:13px; font-family:var(--mono); color:var(--accent); font-weight:500; word-break:break-all; }
  .dz-hint { font-size:12px; color:var(--muted); font-family:var(--mono); }
  /* FIX: remove button on filled drop zone */
  .dz-remove {
    position:absolute; top:8px; right:10px; background:rgba(255,79,79,0.15);
    border:1px solid rgba(255,79,79,0.3); border-radius:6px; color:#ff4f4f;
    font-size:11px; padding:2px 7px; cursor:pointer; font-family:var(--mono);
    z-index:2; transition:background 0.15s;
  }
  .dz-remove:hover { background:rgba(255,79,79,0.3); }

  /* BUTTONS */
  .check-btn {
    width:100%; padding:1rem; background:var(--accent); color:#000;
    border:none; border-radius:10px; font-family:var(--mono); font-size:14px;
    font-weight:600; letter-spacing:1px; text-transform:uppercase;
    cursor:pointer; transition:background 0.15s, transform 0.1s; margin-bottom:2rem;
    box-shadow:0 0 25px rgba(0,229,160,0.3);
  }
  .check-btn:hover:not(:disabled) { background:#00ffb3; }
  .check-btn:active:not(:disabled) { transform:scale(0.99); }
  .check-btn:disabled { opacity:0.35; cursor:not-allowed; }
  .check-btn.busy { background:var(--surface2); color:var(--accent); border:1.5px solid var(--accent2); }

  /* FIX: styled glass download buttons */
  .glass-btn {
    padding:10px 16px; border-radius:8px; cursor:pointer;
    font-family:var(--mono); font-size:12px; font-weight:500; letter-spacing:0.5px;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12);
    color:var(--text); transition:background 0.15s, border-color 0.15s;
    backdrop-filter:blur(8px); display:flex; align-items:center; gap:6px;
  }
  .glass-btn:hover { background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.22); }
  .glass-btn.danger { border-color:rgba(255,79,79,0.3); color:#ff4f4f; background:rgba(255,79,79,0.08); }
  .glass-btn.danger:hover { background:rgba(255,79,79,0.18); }

  /* HISTORY PANEL */
  .history-btn {
    padding:6px 14px; border-radius:8px; border:1px solid var(--border2);
    background:rgba(255,255,255,0.05); color:var(--muted); font-family:var(--mono);
    font-size:11px; cursor:pointer; letter-spacing:1px; transition:all 0.15s;
    backdrop-filter:blur(8px);
  }
  .history-btn:hover { border-color:var(--accent); color:var(--accent); }
  .history-panel {
    position:fixed; top:80px; right:20px; width:320px; max-height:400px;
    overflow-y:auto; background:rgba(17,17,24,0.97); border:1px solid rgba(255,255,255,0.1);
    border-radius:12px; padding:12px; z-index:1000; backdrop-filter:blur(16px);
    box-shadow:0 20px 60px rgba(0,0,0,0.5);
  }
  .history-panel::-webkit-scrollbar { width:4px; }
  .history-panel::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }
  .history-item {
    font-size:11px; padding:8px; border-radius:6px; border-bottom:1px solid rgba(255,255,255,0.05);
    cursor:pointer; transition:background 0.15s; font-family:var(--mono);
  }
  .history-item:hover { background:rgba(0,229,160,0.06); }
  .history-item:last-child { border-bottom:none; }

  /* SPINNER */
  @keyframes spin { to { transform:rotate(360deg); } }
  .spin { display:inline-block; width:13px; height:13px; border:2px solid var(--accent2); border-top-color:var(--accent); border-radius:50%; animation:spin 0.7s linear infinite; vertical-align:middle; margin-right:8px; }

  .err { background:rgba(255,79,79,0.1); border:1px solid rgba(255,79,79,0.3); border-radius:8px; padding:10px 14px; font-family:var(--mono); font-size:12px; color:var(--danger); margin-bottom:1.25rem; line-height:1.6; }

  /* RESULTS */
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

  /* LINES BOX */
  .lines-box { background:var(--surface); border:1px solid var(--border); border-radius:10px; max-height:240px; overflow-y:auto; margin-bottom:1.25rem; }
  .line-row { display:flex; align-items:flex-start; gap:12px; padding:7px 14px; border-bottom:1px solid var(--border); font-family:var(--mono); font-size:12px; position:relative; }
  .line-row:last-child { border-bottom:none; }
  .ln { color:var(--muted); min-width:22px; flex-shrink:0; user-select:none; }
  .lc { color:var(--text); word-break:break-all; flex:1; }
  /* FIX: copy button on matching lines */
  .copy-btn {
    opacity:0; position:absolute; right:8px; top:50%; transform:translateY(-50%);
    background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15);
    border-radius:4px; color:var(--muted); font-size:10px; padding:2px 6px;
    cursor:pointer; font-family:var(--mono); transition:opacity 0.15s, background 0.15s;
  }
  .line-row:hover .copy-btn { opacity:1; }
  .copy-btn:hover { background:rgba(0,229,160,0.15); color:var(--accent); }
  .copy-btn.copied { color:var(--accent); }
  .no-lines { padding:1.25rem; text-align:center; font-family:var(--mono); font-size:12px; color:var(--muted); }
  .lines-box::-webkit-scrollbar { width:4px; }
  .lines-box::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }

  .findings { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:1.25rem 1.5rem; font-family:var(--mono); font-size:12.5px; line-height:1.85; color:var(--text); white-space:pre-wrap; word-break:break-word; }

  .c-none { color:var(--safe); } .c-low { color:#80d8ff; } .c-medium { color:var(--warn); } .c-high { color:var(--danger); }
  .pill-none   { color:var(--safe);   border-color:rgba(0,229,160,0.4);   background:rgba(0,229,160,0.08); }
  .pill-low    { color:#80d8ff;       border-color:rgba(128,216,255,0.4); background:rgba(128,216,255,0.08); }
  .pill-medium { color:var(--warn);   border-color:rgba(245,166,35,0.4);  background:rgba(245,166,35,0.08); }
  .pill-high   { color:var(--danger); border-color:rgba(255,79,79,0.4);   background:rgba(255,79,79,0.08); }
  .stroke-none { stroke:var(--safe); } .stroke-low { stroke:#80d8ff; } .stroke-medium { stroke:var(--warn); } .stroke-high { stroke:var(--danger); }
  .fill-none { background:var(--safe); } .fill-low { background:#80d8ff; } .fill-medium { background:var(--warn); } .fill-high { background:var(--danger); }
`;

// ─── DropZone ────────────────────────────────────────────────────────────────
function DropZone({ label, file, onFile, onRemove }) {
  const [drag, setDrag] = useState(false);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div
      className={`drop-zone${file ? " filled" : ""}${drag ? " drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      {/* FIX: File removal button */}
      {file && (
        <button
          className="dz-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove file"
        >✕</button>
      )}
      <input
        type="file"
        accept=".js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.html,.css,.txt"
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
      />
      <span className="dz-icon">{file ? "✦" : "↑"}</span>
      <div className="dz-label">{label}</div>
      {file
        ? <div className="dz-name">{file.name}</div>
        : <div className="dz-hint">click or drag & drop</div>
      }
    </div>
  );
}

// ─── ScoreRing ────────────────────────────────────────────────────────────────
function ScoreRing({ pct, level }) {
  const R = 43;
  const circ = 2 * Math.PI * R;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 100 100">
        <circle className="ring-track" cx="50" cy="50" r={R} />
        <circle
          className={`ring-fill stroke-${level}`}
          cx="50" cy="50" r={R}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ring-center">
        <span className={`ring-pct c-${level}`}>{pct}%</span>
        <span className="ring-sub">similar</span>
      </div>
    </div>
  );
}

// ─── CopyButton ───────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button className={`copy-btn${copied ? " copied" : ""}`} onClick={handleCopy}>
      {copied ? "✓" : "copy"}
    </button>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {

  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [codeAContent, setCodeAContent] = useState("");
  const [codeBContent, setCodeBContent] = useState("");
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [toggleText, setToggleText] = useState(true);
  const [fade, setFade] = useState(true);
  // Threshold slider + optional toggle
  const [threshold, setThreshold] = useState(4);
  const [usePartialMatch, setUsePartialMatch] = useState(false);

  const historyRef = useRef(null);
  const refA = useRef(null);
  const refB = useRef(null);
  const scrollSyncActive = useRef(false);

  const humanScore = result?.human_score ?? (result ? 100 - result.similarity_percent : 0);
  const level = result ? getLevel(result.similarity_percent) : "none";

  // Load history safely (fixes Safari private mode)
  useEffect(() => {
    const saved = safeStorage.get("plag_history");
    if (saved) setHistory(saved);
  }, []);

  // Animated headline toggle
  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => { setToggleText((p) => !p); setFade(true); }, 300);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  // Close history on outside click
  useEffect(() => {
    const handler = (e) => {
      if (showHistory && historyRef.current && !historyRef.current.contains(e.target))
        setShowHistory(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHistory]);

  // FIX: memoized match set for O(1) lookup instead of per-render filtering
  const matchSet = useMemo(() => {
    if (!result?.matchingLines) return new Set();
    return new Set(result.matchingLines);
  }, [result]);

  // FIX: memoized intensity map so getMatchIntensity doesn't recompute per line per render
  const intensityMap = useMemo(() => {
    if (!result?.matchingLines) return new Map();
    const map = new Map();
    const matchArr = result.matchingLines;
    for (const line of (codeAContent + "\n" + codeBContent).split("\n")) {
      const t = line.trim();
      if (matchArr.includes(t)) { map.set(t, 1); continue; }
      // Only do partial matching if user opted in
      if (!usePartialMatch) { map.set(t, 0); continue; }
      const words = t.split(" ");
      let count = 0;
      for (const match of matchArr)
        for (const word of words)
          if (word.length > threshold && match.includes(word)) count++;
      map.set(t, count > 2 ? 0.6 : count > 0 ? 0.3 : 0);
    }
    return map;
  }, [result, codeAContent, codeBContent, threshold, usePartialMatch]);

  function isMatch(line) { return matchSet.has(line.trim()); }
  function getMatchIntensity(line) { return intensityMap.get(line.trim()) ?? 0; }

  // FIX: debounced sync scroll to prevent jank
  function syncScroll(source, target) {
    if (scrollSyncActive.current) return;
    scrollSyncActive.current = true;
    requestAnimationFrame(() => {
      if (source.current && target.current)
        target.current.scrollTop = source.current.scrollTop;
      scrollSyncActive.current = false;
    });
  }

  function getLevelLabel(v) {
    if (v >= 70) return "HIGH";
    if (v >= 40) return "MEDIUM";
    if (v >= 15) return "LOW";
    return "NONE";
  }

  function clearHistory() {
    safeStorage.remove("plag_history");
    setHistory([]);
  }

  // FIX: swap files instead of requiring re-upload
  function swapFiles() {
    setFileA(fileB);
    setFileB(fileA);
    setCodeAContent(codeBContent);
    setCodeBContent(codeAContent);
  }

  function downloadPDF() {
    if (!result) return;
    const doc = new jsPDF();
    let y = 10;
    doc.setFont("Courier", "Normal");
    doc.setFontSize(10);
    const addLine = (text) => {
      const lines = doc.splitTextToSize(text, 180);
      lines.forEach((line) => {
        if (y > 280) { doc.addPage(); y = 10; }
        doc.text(line, 10, y);
        y += 6;
      });
    };
    addLine("Code Plagiarism Report");
    addLine("----------------------------");
    addLine(`Similarity: ${result.similarity_percent}%`);
    addLine(`Logic Similarity: ${result.logic_similarity}%`);
    addLine(`Structure Similarity: ${result.structure_similarity}%`);
    addLine(`Token Overlap: ${result.token_overlap}%`);
    addLine("");
    addLine(`Language A: ${result.language_a}`);
    addLine(`Language B: ${result.language_b}`);
    addLine("");
    addLine("Summary:");
    addLine(result.summary);
    addLine("");
    addLine("Findings:");
    addLine(result.findings);
    doc.save("plagiarism-report.pdf");
  }

  function downloadReport() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plagiarism-report.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCheck() {
    if (!fileA || !fileB) { setError("Please upload both code files first."); return; }

    setError(""); setResult(null); setLoading(true);

    try {
      const [codeA, codeB] = await Promise.all([readFile(fileA), readFile(fileB)]);
      setCodeAContent(codeA);
      setCodeBContent(codeB);
      const matchingLines = getMatchingLines(codeA, codeB);

      const prompt = `You are an expert code plagiarism analyst.

Analyze the two code files below and return ONLY a valid JSON object. No markdown, no backticks, no extra text — pure JSON only.

Also estimate:
- human_score (0-100): likelihood code is human-written
- ai_generated_likelihood (0-100): likelihood code is AI-generated

Base this on variable naming patterns, repetition, structure rigidity, natural coding style.

File A (${fileA.name}):
${codeA.slice(0, 4000)}

File B (${fileB.name}):
${codeB.slice(0, 4000)}

Return exactly this JSON structure:
{
  "similarity_percent": <integer 0-100>,
  "logic_similarity": <integer 0-100>,
  "structure_similarity": <integer 0-100>,
  "token_overlap": <integer 0-100>,
  "human_score": <integer 0-100>,
  "ai_generated_likelihood": <integer 0-100>,
  "language_a": "<string>",
  "language_b": "<string>",
  "summary": "<text>",
  "findings": "<text>",
  "ai_reason": "<short explanation>"
}`;

 const callGroq = async () => {
  const isDev = import.meta.env.DEV;
  const url = isDev
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "/api/check";

  const headers = {
    "Content-Type": "application/json",
    ...(isDev && { "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}` }),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return ONLY valid JSON. No text, no explanation, no markdown." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `Groq API error ${resp.status}`);
  return data.choices?.[0]?.message?.content || "";
};
      let parsed;
      try {
        parsed = JSON.parse(await callGroq());
      } catch {
        // Retry once
        try { parsed = JSON.parse(await callGroq()); }
        catch { throw new Error("AI is not returning valid JSON. Please try again."); }
      }

      const newResult = { ...parsed, matchingLines, nameA: fileA.name, nameB: fileB.name, timestamp: new Date().toLocaleString() };
      setResult(newResult);
      const updatedHistory = [newResult, ...history].slice(0, 10);
      setHistory(updatedHistory);
      safeStorage.set("plag_history", updatedHistory);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* HEADER */}
        <div className="header">
          <div className="eyebrow">BUILDING THE FUTURE OF CODE INTEGRITY</div>
          <h1 style={{ opacity: fade ? 1 : 0, transform: fade ? "translateY(0)" : "translateY(10px)" }}>
            {toggleText
              ? <>Check for plagiarism in the<br />source code</>
              : <>Code <span style={{ color: "#0da4eb" }}>Plagiarism</span><br />Detector</>}
          </h1>
          <p>
            Detect counterfeit code and software similarities with an advanced plagiarism detection solution.
            Examine potentially copied code by highlighting similarities across multiple sources and structural patterns.
          </p>

          {/* History button — now properly styled */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "15px" }}>
            <button className="history-btn" onClick={() => setShowHistory((p) => !p)}>
              📜 History
            </button>
          </div>
        </div>

        {/* HISTORY PANEL */}
        {showHistory && (
          <div ref={historyRef} className="history-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "11px", color: "#aaa", fontFamily: "var(--mono)", letterSpacing: "1px" }}>HISTORY</span>
              <button className="glass-btn danger" style={{ padding: "3px 8px", fontSize: "10px" }} onClick={clearHistory}>Clear</button>
            </div>
            {history.length === 0
              ? <div style={{ fontSize: "11px", color: "#777", fontFamily: "var(--mono)" }}>No history yet</div>
              : history.map((item, i) => (
                <div key={i} className="history-item" onClick={() => { setResult(item); setShowHistory(false); }}>
                  <span style={{ color: "var(--text)" }}>{item.nameA} ↔ {item.nameB}</span>
                  <span style={{ color: getLevel(item.similarity_percent) === "high" ? "var(--danger)" : getLevel(item.similarity_percent) === "medium" ? "var(--warn)" : "var(--accent)" }}>
                    {" "}| {item.similarity_percent}%
                  </span>
                  <div style={{ color: "#666", marginTop: "2px" }}>{item.timestamp}</div>
                </div>
              ))
            }
          </div>
        )}

        {/* Threshold slider — optional */}
        <div className="slider-row">
          {/* Toggle */}
          <div className="toggle-wrap" onClick={() => setUsePartialMatch((p) => !p)}>
            <div className={`toggle-track${usePartialMatch ? " on" : ""}`}>
              <div className="toggle-thumb" />
            </div>
            <span style={{ color: usePartialMatch ? "var(--accent)" : "var(--muted)", transition: "color 0.2s" }}>
              Partial match highlighting
            </span>
          </div>

          {/* Slider — only shown when enabled */}
          <div className={`slider-row${usePartialMatch ? "" : " slider-disabled"}`}
            style={{ flex: 1, background: "none", border: "none", padding: 0, margin: 0 }}>
            <label>Min word length:</label>
            <input
              type="range" min={2} max={10} value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={!usePartialMatch}
            />
            <span className="slider-val">{threshold}</span>
          </div>
        </div>

        {/* UPLOAD + SWAP */}
        <div className="upload-grid">
          <DropZone label="File A — Original" file={fileA} onFile={setFileA} onRemove={() => setFileA(null)} />
          <DropZone label="File B — Suspect"  file={fileB} onFile={setFileB} onRemove={() => setFileB(null)} />
        </div>

        {/* NEW: Swap files button */}
        {fileA && fileB && (
          <div style={{ textAlign: "center", marginBottom: "0.75rem" }}>
            <button className="glass-btn" style={{ margin: "0 auto" }} onClick={swapFiles}>
              ⇄ Swap Files
            </button>
          </div>
        )}

        <button
          className={`check-btn${loading ? " busy" : ""}`}
          onClick={handleCheck}
          disabled={loading || !fileA || !fileB}
        >
          {loading ? <><span className="spin" />Analyzing...</> : "→ Check for Plagiarism"}
        </button>

        {error && <div className="err">⚠ {error}</div>}

        {result && (
          <div className="results">
            <div className="section-label">Analysis results</div>

            <div className="score-card">
              <div className="score-inner">
                <ScoreRing pct={result.similarity_percent} level={level} />
                <div className="stat-row">
                  <div className="stat-item">
                    <div className="stat-label">Human-written</div>
                    <div className="stat-value" style={{ color: "#00e5a0" }}>{humanScore}%</div>
                  </div>
                  <div className="divider-v" />
                  <div className="stat-item">
                    <div className="stat-label">AI-generated</div>
                    <div className="stat-value" style={{ color: "#b08dff" }}>{result.ai_generated_likelihood ?? "—"}%</div>
                  </div>
                  <div className="divider-v" />
                  <div className="stat-item">
                    <div className="stat-label">Plagiarism</div>
                    <div className="stat-value" style={{ color: "#ff4f4f" }}>{result.similarity_percent}%</div>
                  </div>
                </div>
                <div className="prog-bar">
                  <div className="prog-fill" style={{ width: `${humanScore}%` }} />
                </div>
                {result.ai_reason && (
                  <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--muted)", fontFamily: "var(--mono)", lineHeight: "1.6" }}>
                    🤖 {result.ai_reason}
                  </div>
                )}
              </div>

              <div className="score-info">
                <div className={`verdict-pill pill-${level}`}>{getVerdict(result.similarity_percent)}</div>
                <div className="score-summary">{result.summary}</div>
                <div className="lang-row">{result.language_a} → {result.language_b}</div>
              </div>

              {/* FIX: properly styled download buttons */}
              <div className="download-row">
                <button className="glass-btn" onClick={downloadPDF}>📄 PDF Report</button>
                <button className="glass-btn" onClick={downloadReport}>⬇ JSON Report</button>
              </div>
            </div>

            {/* METRICS */}
            <div className="metrics">
              {[
                { label: "Logic similarity", val: result.logic_similarity },
                { label: "Structure match",  val: result.structure_similarity },
                { label: "Token overlap",    val: result.token_overlap },
              ].map(({ label, val }) => {
                const lv = getLevel(val);
                return (
                  <div className="metric" key={label}>
                    <div className="m-lbl">{label}</div>
                    <div className={`m-val c-${lv}`}>{Math.round(val)}%</div>
                    <div className="m-bar">
                      <div className={`m-fill fill-${lv}`} style={{ width: `${val}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* MATCHING LINES — with copy buttons */}
            <div className="section-label">
              Matching lines — {result.matchingLines.length} exact match{result.matchingLines.length !== 1 ? "es" : ""} found
            </div>
            <div className="lines-box">
              {result.matchingLines.length === 0
                ? <div className="no-lines">No exact line matches detected</div>
                : result.matchingLines.slice(0, 100).map((line, i) => (
                  <div key={i} className="line-row" style={{ background: "rgba(255,79,79,0.12)" }}>
                    <span className="ln">{i + 1}</span>
                    <span className="lc" style={{ color: "#ff4f4f" }}>{line}</span>
                    <CopyButton text={line} />
                  </div>
                ))
              }
            </div>

            {/* SIMILARITY BREAKDOWN */}
            <div className="section-label">Similarity Breakdown</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "1rem" }}>
              {[
                { label: "Logic",     val: result.logic_similarity },
                { label: "Structure", val: result.structure_similarity },
                { label: "Tokens",    val: result.token_overlap },
                { label: "Verdict",   text: getVerdict(result.similarity_percent) },
              ].map(({ label, val, text }) => (
                <div className="metric" key={label}>
                  <div className="m-lbl">{label}</div>
                  <div className="m-val">{text ?? getLevelLabel(val)}</div>
                </div>
              ))}
            </div>

            {/* FULL CODE COMPARISON */}
            <div className="section-label">Full Code Comparison</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {[
                { ref: refA, other: refB, content: codeAContent },
                { ref: refB, other: refA, content: codeBContent },
              ].map(({ ref, other, content }, idx) => (
                <div key={idx} className="lines-box" ref={ref} onScroll={() => syncScroll(ref, other)}>
                  {content.split("\n").map((line, i) => (
                    <div key={i} className="line-row"
                      style={{ background: `rgba(20,229,160,${getMatchIntensity(line) * 0.25})` }}>
                      <span className="ln">{i + 1}</span>
                      <span className="lc" style={{ color: isMatch(line) ? "#ff4f4f" : "var(--text)" }}>
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="section-label">Detailed findings</div>
            <div className="findings">{result.findings}</div>
          </div>
        )}
      </div>
    </>
  );
}
