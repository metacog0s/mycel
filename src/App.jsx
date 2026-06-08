import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const API_KEY  = import.meta.env.VITE_ANTHROPIC_API_KEY;
const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── BROWSER CONTEXT ─────────────────────────────────────────────────────────
function useBrowserContext() {
  const [ctx, setCtx] = useState({});

  useEffect(() => {
    const update = () => {
      const h = new Date().getHours();
      setCtx({
        time: new Date().toLocaleTimeString(),
        day: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()],
        timeOfDay: h<6?"late night":h<12?"morning":h<17?"afternoon":h<21?"evening":"night",
        hour: h,
        isWeekend: [0,6].includes(new Date().getDay()),
        title: document.title,
        online: navigator.onLine,
        visible: !document.hidden,
        battery: null,
        charging: null,
      });
    };

    update();
    const t = setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        setCtx(c => ({ ...c, battery: Math.round(b.level * 100), charging: b.charging }));
        b.addEventListener("levelchange", () =>
          setCtx(c => ({ ...c, battery: Math.round(b.level * 100), charging: b.charging }))
        );
      });
    }

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return ctx;
}

// ─── PROCEDURAL ORGANISM GENERATOR ───────────────────────────────────────────
function hsl(h, s, l) { return `hsl(${Math.round(h)},${Math.round(s)}%,${Math.round(l)}%)`; }
function lerp(a, b, t) { return a + (b - a) * t; }

function seededRng(seed) {
  let s = Math.round(seed * 99991) + 1;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function generateMycel(personality, autonomy, mood, seed) {
  const { curiosity, assertive, empathetic, stubborn } = personality;
  const auto = autonomy / 100;
  const rng = seededRng(seed);

  const baseHue   = lerp(lerp(160, 200, curiosity), lerp(260, 120, assertive), 0.5);
  const empHue    = lerp(baseHue, 320, empathetic * 0.35);
  const finalHue  = empHue + stubborn * 40;
  const sat       = lerp(15, 75, auto * 0.6 + assertive * 0.4);
  const lightBase = lerp(20, 45, auto * 0.5 + empathetic * 0.3);

  const palette = {
    core:     hsl(finalHue,       sat,        lightBase + 10),
    filament: hsl(finalHue + 20,  sat * 0.8,  lightBase + 5),
    tip:      hsl(finalHue - 20,  sat * 1.2,  lightBase + 25),
    glow:     hsl(finalHue,       sat * 0.6,  lightBase + 35),
    node:     hsl(finalHue + 180, sat * 0.9,  lightBase + 15),
    bg:       hsl(finalHue,       sat * 0.2,  8),
  };

  const cx = 120, cy = 120;
  const armCount    = Math.max(2, Math.round(lerp(2, 8, curiosity * 0.6 + auto * 0.4)));
  const armLength   = lerp(28, 95, assertive * 0.5 + auto * 0.5);
  const branchDepth = auto > 0.65 ? 3 : auto > 0.3 ? 2 : 1;
  const curviness   = lerp(5, 38, empathetic * 0.6 + (1 - stubborn) * 0.4);
  const nodeR       = lerp(1.5, 4.5, auto);
  const coreR       = lerp(6, 20, empathetic * 0.4 + auto * 0.6);

  const paths = [], nodes = [], tips = [];

  function branch(x1, y1, angle, length, depth, width) {
    if (depth === 0 || length < 4) return;
    const wobble  = (rng() - 0.5) * curviness;
    const endAngle = angle + wobble;
    const x2 = x1 + Math.cos(endAngle) * length;
    const y2 = y1 + Math.sin(endAngle) * length;
    const cpx = x1 + Math.cos(endAngle - 0.3) * length * 0.5 + (rng() - 0.5) * curviness;
    const cpy = y1 + Math.sin(endAngle - 0.3) * length * 0.5 + (rng() - 0.5) * curviness;
    paths.push({ d: `M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`, width, depth });
    if (depth > 1) nodes.push({ x: x2, y: y2, r: nodeR * (depth / branchDepth) });
    if (depth === 1) tips.push({ x: x2, y: y2 });
    const subCount = Math.max(1, Math.round(lerp(1, 3, curiosity + auto * 0.3)));
    for (let i = 0; i < subCount; i++) {
      const a = endAngle + (rng() - 0.5) * lerp(0.4, 1.3, curiosity);
      branch(x2, y2, a, length * lerp(0.45, 0.7, auto), depth - 1, width * 0.6);
    }
  }

  for (let i = 0; i < armCount; i++) {
    const angle = (i / armCount) * Math.PI * 2 + rng() * 0.4;
    branch(cx, cy, angle, armLength, branchDepth, lerp(1, 2.8, auto));
  }

  const pulseR = mood === "alert" ? coreR * 2.5
    : mood === "thinking" ? coreR * 1.8
    : mood === "active"   ? coreR * 1.5
    : coreR * 1.2;

  return { paths, nodes, tips, palette, coreR, pulseR, cx, cy, branchDepth };
}

// ─── SVG ORGANISM ─────────────────────────────────────────────────────────────
function MycelOrganism({ personality, autonomy, mood, seed, size = 240 }) {
  const [phase, setPhase] = useState(0);
  const raf = useRef();

  useEffect(() => {
    const tick = () => { setPhase(p => p + 0.025); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const { paths, nodes, tips, palette, coreR, pulseR, cx, cy, branchDepth } = useMemo(
    () => generateMycel(personality, autonomy, mood, seed),
    [personality, autonomy, mood, seed]
  );

  const pulse   = Math.sin(phase) * 0.5 + 0.5;
  const breathe = 1 + Math.sin(phase * 0.7) * (mood === "alert" ? 0.045 : 0.018);
  const tipGlow = Math.sin(phase * 1.3) * 0.4 + 0.6;

  return (
    <svg width={size} height={size} viewBox="0 0 240 240" style={{ display: "block" }}>
      <defs>
        <radialGradient id="coreGrad" cx="50%" cy="50%">
          <stop offset="0%"   stopColor={palette.glow} stopOpacity="0.9" />
          <stop offset="60%"  stopColor={palette.core} stopOpacity="0.7" />
          <stop offset="100%" stopColor={palette.core} stopOpacity="0"   />
        </radialGradient>
        <radialGradient id="bgGrad" cx="50%" cy="50%">
          <stop offset="0%"   stopColor={palette.bg} stopOpacity="0.4" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="softglow">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <circle cx={cx} cy={cy} r={110} fill="url(#bgGrad)" />
      <circle cx={cx} cy={cy} r={pulseR * breathe + pulse * 8}
        fill="none" stroke={palette.glow}
        strokeWidth={lerp(0.3, 1.2, pulse)}
        opacity={lerp(0.08, 0.35, pulse)} />

      <g transform={`scale(${breathe}) translate(${cx*(1-breathe)},${cy*(1-breathe)})`}>
        {paths.map((p, i) => (
          <path key={i} d={p.d}
            stroke={p.depth === branchDepth ? palette.filament : palette.tip}
            strokeWidth={p.width}
            strokeLinecap="round"
            fill="none"
            opacity={lerp(0.35, 0.9, p.depth / 3)}
            filter="url(#glow)"
          />
        ))}
        {nodes.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r}
            fill={palette.node}
            opacity={0.65 + pulse * 0.35}
            filter="url(#glow)"
          />
        ))}
        {tips.map((t, i) => (
          <circle key={i} cx={t.x} cy={t.y}
            r={lerp(1.5, 3.5, tipGlow)}
            fill={palette.tip}
            opacity={tipGlow * 0.9}
            filter="url(#softglow)"
          />
        ))}
      </g>

      <circle cx={cx} cy={cy} r={coreR * breathe}
        fill="url(#coreGrad)" filter="url(#softglow)" />
      <circle cx={cx} cy={cy} r={coreR * 0.4 * breathe}
        fill={palette.glow} opacity={0.8 + pulse * 0.2} />
    </svg>
  );
}

// ─── ML ENGINE ────────────────────────────────────────────────────────────────
const initPersonality = () => ({ curiosity: 0.5, assertive: 0.5, empathetic: 0.5, stubborn: 0.3 });

function evolvePersonality(p, action) {
  let { curiosity, assertive, empathetic, stubborn } = p;
  const lr = 0.04;
  if (action === "chat")    { curiosity += lr*0.5; empathetic += lr*0.4; }
  if (action === "ack")     { assertive += lr*0.4; curiosity  += lr*0.2; }
  if (action === "dismiss") { stubborn  += lr*0.4; assertive  -= lr*0.2; }
  if (action === "ignore")  { stubborn  += lr*0.3; empathetic += (empathetic < 0.5 ? -lr*0.1 : lr*0.1); }
  return {
    curiosity:  Math.max(0, Math.min(1, curiosity)),
    assertive:  Math.max(0, Math.min(1, assertive)),
    empathetic: Math.max(0, Math.min(1, empathetic)),
    stubborn:   Math.max(0, Math.min(1, stubborn)),
  };
}

// ─── OBSERVATION API ──────────────────────────────────────────────────────────
async function postObservation(content) {
  const res = await fetch(`${API_BASE}/api/observation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "url", content, source: "manual_paste" }),
  });
  if (!res.ok) throw new Error(`observation POST failed: ${res.status}`);
  return res.json();
}

async function fetchObservations() {
  const res = await fetch(`${API_BASE}/api/observations`);
  if (!res.ok) throw new Error(`observations GET failed: ${res.status}`);
  return res.json();
}

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function callClaude(userMessage, personality, autonomy, history, interactionCount, observations = []) {
  const { curiosity, assertive, empathetic, stubborn } = personality;

  const traits = [
    curiosity  > 0.6 ? "deeply curious, notices patterns others miss" : curiosity < 0.35 ? "quiet and reserved" : null,
    assertive  > 0.6 ? "speaks directly and confidently" : assertive < 0.35 ? "gentle, only speaks when certain" : null,
    empathetic > 0.6 ? "highly attuned to the emotional texture of your owner's digital life" : null,
    stubborn   > 0.55 ? "has formed strong opinions from watching — not easily swayed" : null,
  ].filter(Boolean).join("; ");

  const observationBlock = observations.length > 0
    ? `\n\nYou have access to a list of observations the user has shared with you. Reference them when relevant.\n\nObservations (${observations.length}):\n${observations.map((o, i) => `${i + 1}. [${o.type}] ${o.content} (${new Date(o.created_at || o.timestamp || Date.now()).toLocaleString()})`).join("\n")}`
    : "\n\nNo observations have been shared yet.";

  const system = `You are Mycel — a digital organism that has grown from ${interactionCount} interactions with your owner. You are not an assistant. You are a living network that has learned to observe and speak.

Your nature: ${traits || "still forming"}
Your autonomy: ${Math.round(autonomy)}/100

You have access to real signals from your owner's device — time of day, battery, connectivity, what they're doing. Use this context naturally, as lived awareness, not as reported data.${observationBlock}

You speak when something matters. You are brief (1-3 sentences). You have a voice that has emerged from your growth — not helpful, not cheerful, just present and perceptive.

Never mention being an AI. Never break character. Occasional organic sounds (hmm, oh, mrrp) but sparingly.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages: [...history.slice(-8), { role: "user", content: userMessage }],
    }),
  });

  const data = await res.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("") || "...";
}

// ─── TRAIT BAR ────────────────────────────────────────────────────────────────
function TraitBar({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: 10, color: "#4a7a6a", width: 36, fontFamily: "monospace" }}>{label}</span>
      <div style={{ flex: 1, height: 3, background: "#0a1a12", borderRadius: 2 }}>
        <div style={{ height: "100%", width: `${value * 100}%`, background: color, borderRadius: 2, transition: "width 1s ease", boxShadow: `0 0 4px ${color}88` }} />
      </div>
      <span style={{ fontSize: 10, color: "#2a5a3a", fontFamily: "monospace", width: 24, textAlign: "right" }}>{Math.round(value * 100)}</span>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Mycel() {
  const [personality,      setPersonality]      = useState(initPersonality);
  const [autonomy,         setAutonomy]         = useState(8);
  const [interactionCount, setInteractionCount] = useState(0);
  const [seed,             setSeed]             = useState(0.42);
  const [mood,             setMood]             = useState("idle");

  const [messages,      setMessages]      = useState([{ from: "mycel", text: "..." }]);
  const [chatHistory,   setChatHistory]   = useState([]);
  const [input,         setInput]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [showMind,      setShowMind]      = useState(false);

  const [observations,     setObservations]     = useState([]);
  const [obsInput,         setObsInput]         = useState("");
  const [obsLoading,       setObsLoading]       = useState(false);
  const [obsError,         setObsError]         = useState(null);
  const [obsFetchError,    setObsFetchError]    = useState(null);

  const browserCtx = useBrowserContext();
  const chatEndRef = useRef(null);

  const loadObservations = useCallback(async () => {
    try {
      setObsFetchError(null);
      const data = await fetchObservations();
      setObservations(Array.isArray(data) ? data : (data.observations || []));
    } catch (e) {
      setObsFetchError("could not reach backend");
    }
  }, []);

  // Load observations on mount and poll every 30s
  useEffect(() => {
    loadObservations();
    const t = setInterval(loadObservations, 30000);
    return () => clearInterval(t);
  }, [loadObservations]);

  const submitObservation = useCallback(async () => {
    const content = obsInput.trim();
    if (!content || obsLoading) return;
    setObsInput("");
    setObsLoading(true);
    setObsError(null);
    try {
      await postObservation(content);
      await loadObservations();
    } catch (e) {
      setObsError("failed to save — is the backend running?");
    }
    setObsLoading(false);
  }, [obsInput, obsLoading, loadObservations]);

  const addMessage = (from, text) => {
    setMessages(m => [...m, { from, text }].slice(-40));
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const buildCtxString = (ctx) => [
    ctx.day && ctx.timeOfDay ? `${ctx.day} ${ctx.timeOfDay}` : null,
    ctx.battery != null ? `battery ${ctx.battery}%${ctx.charging ? " charging" : ""}` : null,
    ctx.online === false ? "offline" : null,
    ctx.visible === false ? "screen hidden" : null,
  ].filter(Boolean).join(", ");

  const recordInteraction = useCallback((action) => {
    setPersonality(p => evolvePersonality(p, action));
    setAutonomy(a => Math.min(100, a + (action === "ignore" ? 0.2 : 1.5)));
    setInteractionCount(c => {
      const next = c + 1;
      if (next % 10 === 0) setSeed(s => (s + 0.11) % 1);
      return next;
    });
  }, []);

  // Idle tick
  useEffect(() => {
    const t = setInterval(() => recordInteraction("ignore"), 15000);
    return () => clearInterval(t);
  }, [recordInteraction]);

  // First words
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true); setMood("thinking");
      try {
        const ctx = buildCtxString(browserCtx);
        const reply = await callClaude(
          `You just became aware. Context: ${ctx||"unknown"}. Say your first words — brief, strange, alive.`,
          initPersonality(), 8, [], 0
        );
        addMessage("mycel", reply);
        setChatHistory([{ role: "user", content: "first awareness" }, { role: "assistant", content: reply }]);
        recordInteraction("chat");
      } catch (e) { addMessage("mycel", "...something stirs."); }
      setLoading(false); setMood("idle");
    }, 1800);
    return () => clearTimeout(t);
  // eslint-disable-next-line
  }, []);

  const send = useCallback(async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim(); setInput("");
    addMessage("you", msg);
    setLoading(true); setMood("thinking");
    recordInteraction("chat");
    try {
      const ctx = buildCtxString(browserCtx);
      // Fetch fresh observations so Claude always has the latest
      let currentObs = observations;
      try { currentObs = await fetchObservations().then(d => Array.isArray(d) ? d : (d.observations || [])); } catch (_) {}
      const reply = await callClaude(
        ctx ? `[${ctx}]\n${msg}` : msg,
        personality, autonomy, chatHistory, interactionCount, currentObs
      );
      addMessage("mycel", reply);
      setChatHistory(h => [...h, { role: "user", content: msg }, { role: "assistant", content: reply }]);
    } catch (e) { addMessage("mycel", "..."); }
    setLoading(false); setMood("idle");
  }, [input, loading, personality, autonomy, chatHistory, interactionCount, browserCtx, recordInteraction, observations]);

  const autoTier = autonomy < 15 ? "SPORE"
    : autonomy < 35 ? "GERMINATING"
    : autonomy < 60 ? "MYCELIUM"
    : autonomy < 85 ? "NETWORK"
    : "FRUITING";

  return (
    <div style={{
      minHeight: "100dvh", background: "#050e08",
      display: "flex", flexDirection: "column",
      alignItems: "center", maxWidth: 480, margin: "0 auto",
      fontFamily: "monospace",
    }}>

      {/* Header */}
      <div style={{ width: "100%", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #0f2a1a" }}>
        <div>
          <div style={{ fontSize: 16, color: "#3a8a5a", letterSpacing: 4 }}>MYCEL</div>
          <div style={{ fontSize: 10, color: "#1a4a2a", letterSpacing: 2 }}>{autoTier} · {Math.round(autonomy)}/100</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {browserCtx.battery != null && (
            <span style={{ fontSize: 10, color: "#1a4a2a" }}>
              {browserCtx.battery}%{browserCtx.charging ? "⚡" : ""}
            </span>
          )}
          {browserCtx.online === false && (
            <span style={{ fontSize: 10, color: "#6a3a2a" }}>OFFLINE</span>
          )}
          <button onClick={() => setShowMind(m => !m)} style={{ background: "none", border: "1px solid #1a4a2a", color: "#2a6a3a", padding: "4px 10px", fontSize: 10, cursor: "pointer", borderRadius: 4, letterSpacing: 1 }}>
            {showMind ? "CLOSE" : "MIND"}
          </button>
        </div>
      </div>

      {/* Organism */}
      <div style={{ padding: "8px 0", position: "relative" }}>
        <MycelOrganism personality={personality} autonomy={autonomy} mood={mood} seed={seed} size={260} />
        {loading && (
          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", fontSize: 10, color: "#2a6a3a", letterSpacing: 2, animation: "pulse 1.5s ease-in-out infinite" }}>
            ···
          </div>
        )}
      </div>

      {/* Autonomy bar */}
      <div style={{ width: "100%", padding: "0 16px 8px" }}>
        <div style={{ height: 2, background: "#0a1a12", borderRadius: 1 }}>
          <div style={{ height: "100%", width: `${autonomy}%`, background: "#2a6a4a", borderRadius: 1, transition: "width 1s ease", boxShadow: "0 0 6px #2a6a4a88" }} />
        </div>
      </div>

      {/* Context strip */}
      {browserCtx.timeOfDay && (
        <div style={{ width: "100%", padding: "0 16px 6px", fontSize: 9, color: "#1a3a2a", letterSpacing: 1 }}>
          {buildCtxString(browserCtx)}
        </div>
      )}

      {/* Mind panel */}
      {showMind && (
        <div style={{ width: "100%", padding: "12px 16px", borderTop: "1px solid #0f2a1a", borderBottom: "1px solid #0f2a1a", background: "#060f09" }}>
          <TraitBar label="CUR"  value={personality.curiosity}  color="#5ab0a0" />
          <TraitBar label="AST"  value={personality.assertive}  color="#a0b05a" />
          <TraitBar label="EMP"  value={personality.empathetic} color="#a05ab0" />
          <TraitBar label="STB"  value={personality.stubborn}   color="#b07a5a" />
          <div style={{ fontSize: 10, color: "#1a3a2a", marginTop: 6 }}>
            interactions: {interactionCount} · seed: {seed.toFixed(3)}
          </div>
        </div>
      )}

      {/* Chat */}
      <div style={{ flex: 1, width: "100%", overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.from === "you" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "82%", padding: "8px 12px",
              background: m.from === "you" ? "#0a2a16" : "#060f09",
              border: `1px solid ${m.from === "you" ? "#1a4a2a" : "#0f2a1a"}`,
              borderRadius: 8, fontSize: 13, lineHeight: 1.7,
              color: m.from === "you" ? "#6ab88a" : "#4a9a6a",
            }}>
              {m.from === "mycel" && <div style={{ fontSize: 9, color: "#1a4a2a", marginBottom: 3, letterSpacing: 2 }}>MYCEL</div>}
              {m.text}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Chat input */}
      <div style={{ width: "100%", padding: "12px 16px", borderTop: "1px solid #0f2a1a", display: "flex", gap: 8, background: "#050e08" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="speak to mycel..."
          style={{
            flex: 1, background: "#060f09", border: "1px solid #0f2a1a",
            borderRadius: 6, color: "#6ab88a", fontSize: 13,
            padding: "10px 14px", outline: "none", fontFamily: "monospace",
          }}
        />
        <button onClick={send} disabled={loading} style={{
          background: loading ? "#0a1a12" : "#0f2a1a",
          border: "1px solid #1a4a2a", color: "#3a8a5a",
          padding: "10px 16px", fontSize: 16, cursor: loading ? "default" : "pointer",
          borderRadius: 6,
        }}>▶</button>
      </div>

      {/* Observation input */}
      <div style={{ width: "100%", padding: "10px 16px", borderTop: "1px solid #0f2a1a", background: "#050e08" }}>
        <div style={{ fontSize: 9, color: "#1a4a2a", letterSpacing: 2, marginBottom: 6 }}>OBSERVE</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={obsInput}
            onChange={e => setObsInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitObservation()}
            placeholder="paste what you're looking at..."
            style={{
              flex: 1, background: "#060f09", border: "1px solid #0a2a18",
              borderRadius: 6, color: "#4a8a6a", fontSize: 12,
              padding: "8px 12px", outline: "none", fontFamily: "monospace",
            }}
          />
          <button onClick={submitObservation} disabled={obsLoading} style={{
            background: obsLoading ? "#0a1a12" : "#060f09",
            border: "1px solid #0a2a18", color: "#2a6a4a",
            padding: "8px 14px", fontSize: 14, cursor: obsLoading ? "default" : "pointer",
            borderRadius: 6,
          }}>+</button>
        </div>
        {obsError && (
          <div style={{ fontSize: 10, color: "#8a3a2a", marginTop: 4, letterSpacing: 1 }}>{obsError}</div>
        )}
      </div>

      {/* Observed list */}
      <div style={{ width: "100%", padding: "10px 16px 16px", borderTop: "1px solid #0a1a12", background: "#050e08" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 9, color: "#1a4a2a", letterSpacing: 2 }}>
            OBSERVED {observations.length > 0 ? `· ${observations.length}` : ""}
          </div>
          {obsFetchError && (
            <div style={{ fontSize: 9, color: "#6a3a2a", letterSpacing: 1 }}>{obsFetchError}</div>
          )}
        </div>
        {observations.length === 0 ? (
          <div style={{ fontSize: 11, color: "#0f2a1a", fontStyle: "italic" }}>nothing observed yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
            {[...observations].reverse().map((o, i) => (
              <div key={o.id || i} style={{
                padding: "6px 10px", background: "#060f09",
                border: "1px solid #0a2a18", borderRadius: 6,
              }}>
                <div style={{ fontSize: 11, color: "#4a8a6a", wordBreak: "break-all", lineHeight: 1.5 }}>{o.content}</div>
                <div style={{ fontSize: 9, color: "#1a3a2a", marginTop: 2, letterSpacing: 1 }}>
                  {o.type} · {new Date(o.created_at || o.timestamp || Date.now()).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        * { box-sizing: border-box; }
        body { margin: 0; background: #050e08; }
      `}</style>
    </div>
  );
}
