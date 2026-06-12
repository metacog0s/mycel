import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
const DB_NAME = "mycel";
const DB_VERSION = 1;
const STORE = "state";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

async function loadMycelState() {
  try {
    const saved = await dbGet("mycel-state");
    return saved || null;
  } catch(e) { return null; }
}

async function saveMycelState(state) {
  try { await dbSet("mycel-state", state); }
  catch(e) { console.error("Failed to save state:", e); }
}

// ─── BROWSER CONTEXT ─────────────────────────────────────────────────────────
function useBrowserContext() {
  const [ctx, setCtx] = useState({});
  const idleTimer     = useRef(null);
  const lastActivity  = useRef(Date.now());
  const visitStart    = useRef(Date.now());
  const scrollDepth   = useRef(0);

  useEffect(() => {
    const update = (extra = {}) => {
      const h    = new Date().getHours();
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      setCtx(c => ({
        ...c,
        time:        new Date().toLocaleTimeString(),
        day:         ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()],
        timeOfDay:   h<6?"late night":h<12?"morning":h<17?"afternoon":h<21?"evening":"night",
        hour:        h,
        isWeekend:   [0,6].includes(new Date().getDay()),
        title:       document.title,
        online:      navigator.onLine,
        visible:     !document.hidden,
        memory:      navigator.deviceMemory || null,
        cores:       navigator.hardwareConcurrency || null,
        screenW:     window.screen.width,
        screenH:     window.screen.height,
        orientation: window.screen.orientation?.type || null,
        connectionType: conn?.effectiveType || null,
        downlink:    conn?.downlink || null,
        saveData:    conn?.saveData || false,
        scrollDepth: scrollDepth.current,
        idleSecs:    Math.round((Date.now() - lastActivity.current) / 1000),
        sessionSecs: Math.round((Date.now() - visitStart.current) / 1000),
        ...extra,
      }));
    };

    const onActivity = () => {
      lastActivity.current = Date.now();
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => update({ idle:true }), 60000);
      update({ idle:false });
    };

    const onScroll = () => {
      const depth = Math.round(
        (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
      );
      scrollDepth.current = Math.max(scrollDepth.current, depth || 0);
      onActivity();
    };

    const onVisibility  = () => update({ visible: !document.hidden });
    const onOrientation = () => update({ orientation: window.screen.orientation?.type || null });

    const recordVisit = async () => {
      try {
        const visits = await dbGet("visit-history") || [];
        const now    = Date.now();
        visits.push({ ts: now, hour: new Date().getHours(), day: new Date().getDay() });
        const recent = visits.slice(-50);
        await dbSet("visit-history", recent);

        const hours      = recent.map(v => v.hour);
        const avgHour    = Math.round(hours.reduce((a,b) => a+b, 0) / hours.length);
        const dayCount   = {};
        recent.forEach(v => { dayCount[v.day] = (dayCount[v.day]||0)+1; });
        const mostActiveDay = Object.entries(dayCount).sort((a,b)=>b[1]-a[1])[0]?.[0];
        const daysSinceFirst = recent.length > 1
          ? Math.round((now - recent[0].ts) / 86400000) : 0;

        update({
          visitCount:      recent.length,
          avgVisitHour:    avgHour,
          mostActiveDay:   ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][mostActiveDay] || null,
          daysSinceFirst,
          lastVisitGap:    recent.length > 1
            ? Math.round((now - recent[recent.length-2].ts) / 60000) : null,
        });
      } catch(e) {}
    };

    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        setCtx(c => ({ ...c, battery: Math.round(b.level*100), charging: b.charging }));
        b.addEventListener("levelchange",   () => setCtx(c => ({ ...c, battery: Math.round(b.level*100) })));
        b.addEventListener("chargingchange",() => setCtx(c => ({ ...c, charging: b.charging })));
      });
    }

    const conn = navigator.connection;
    if (conn) conn.addEventListener("change", () => update());

    update();
    recordVisit();

    const ticker = setInterval(() => update(), 30000);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online",   () => update({ online:true  }));
    window.addEventListener("offline",  () => update({ online:false }));
    window.addEventListener("scroll",   onScroll,      { passive:true });
    window.addEventListener("resize",   onOrientation);
    document.addEventListener("mousemove",  onActivity);
    document.addEventListener("keydown",    onActivity);
    document.addEventListener("touchstart", onActivity, { passive:true });
    document.addEventListener("click",      onActivity);

    return () => {
      clearInterval(ticker);
      clearTimeout(idleTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll",   onScroll);
      window.removeEventListener("resize",   onOrientation);
      document.removeEventListener("mousemove",  onActivity);
      document.removeEventListener("keydown",    onActivity);
      document.removeEventListener("touchstart", onActivity);
      document.removeEventListener("click",      onActivity);
    };
  }, []);

  return ctx;
}

// ─── PROCEDURAL ORGANISM ─────────────────────────────────────────────────────
function hsl(h, s, l) { return `hsl(${Math.round(h)},${Math.round(s)}%,${Math.round(l)}%)`; }
function lerp(a, b, t) { return a + (b - a) * t; }

function seededRng(seed) {
  let s = Math.round(seed * 99991) + 1;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function generateMycel(personality, autonomy, mood, seed) {
  const { curiosity, assertive, empathetic, stubborn } = personality;
  const auto = autonomy / 100;
  const rng  = seededRng(seed);

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
    const wobble   = (rng() - 0.5) * curviness;
    const endAngle = angle + wobble;
    const x2  = x1 + Math.cos(endAngle) * length;
    const y2  = y1 + Math.sin(endAngle) * length;
    const cpx = x1 + Math.cos(endAngle - 0.3) * length * 0.5 + (rng() - 0.5) * curviness;
    const cpy = y1 + Math.sin(endAngle - 0.3) * length * 0.5 + (rng() - 0.5) * curviness;
    paths.push({ d:`M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`, width, depth });
    if (depth > 1) nodes.push({ x:x2, y:y2, r:nodeR * (depth / branchDepth) });
    if (depth === 1) tips.push({ x:x2, y:y2 });
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

  const pulseR = mood === "alert"   ? coreR * 2.5
    : mood === "thinking" ? coreR * 1.8
    : mood === "active"   ? coreR * 1.5
    : coreR * 1.2;

  return { paths, nodes, tips, palette, coreR, pulseR, cx, cy, branchDepth };
}

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
    <svg width={size} height={size} viewBox="0 0 240 240" style={{ display:"block" }}>
      <defs>
        <radialGradient id="coreGrad" cx="50%" cy="50%">
          <stop offset="0%"   stopColor={palette.glow} stopOpacity="0.9"/>
          <stop offset="60%"  stopColor={palette.core} stopOpacity="0.7"/>
          <stop offset="100%" stopColor={palette.core} stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="bgGrad" cx="50%" cy="50%">
          <stop offset="0%"   stopColor={palette.bg} stopOpacity="0.4"/>
          <stop offset="100%" stopColor="transparent"/>
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

      <circle cx={cx} cy={cy} r={110} fill="url(#bgGrad)"/>
      <circle cx={cx} cy={cy} r={pulseR * breathe + pulse * 8}
        fill="none" stroke={palette.glow}
        strokeWidth={lerp(0.3, 1.2, pulse)}
        opacity={lerp(0.08, 0.35, pulse)}/>

      <g transform={`scale(${breathe}) translate(${cx*(1-breathe)},${cy*(1-breathe)})`}>
        {paths.map((p,i) => (
          <path key={i} d={p.d}
            stroke={p.depth === branchDepth ? palette.filament : palette.tip}
            strokeWidth={p.width} strokeLinecap="round" fill="none"
            opacity={lerp(0.35, 0.9, p.depth / 3)} filter="url(#glow)"/>
        ))}
        {nodes.map((n,i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r}
            fill={palette.node} opacity={0.65 + pulse * 0.35} filter="url(#glow)"/>
        ))}
        {tips.map((t,i) => (
          <circle key={i} cx={t.x} cy={t.y}
            r={lerp(1.5, 3.5, tipGlow)} fill={palette.tip}
            opacity={tipGlow * 0.9} filter="url(#softglow)"/>
        ))}
      </g>

      <circle cx={cx} cy={cy} r={coreR * breathe}
        fill="url(#coreGrad)" filter="url(#softglow)"/>
      <circle cx={cx} cy={cy} r={coreR * 0.4 * breathe}
        fill={palette.glow} opacity={0.8 + pulse * 0.2}/>
    </svg>
  );
}

// ─── ML ENGINE ────────────────────────────────────────────────────────────────
const initPersonality = () => ({ curiosity:0.5, assertive:0.5, empathetic:0.5, stubborn:0.3 });

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

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function callClaude(userMessage, personality, autonomy, history, interactionCount) {
  const { curiosity, assertive, empathetic, stubborn } = personality;

  const traits = [
    curiosity  > 0.6 ? "deeply curious, notices patterns others miss" : curiosity < 0.35 ? "quiet and reserved" : null,
    assertive  > 0.6 ? "speaks directly and confidently" : assertive < 0.35 ? "gentle, only speaks when certain" : null,
    empathetic > 0.6 ? "highly attuned to the emotional texture of your owner's digital life" : null,
    stubborn   > 0.55 ? "has formed strong opinions from watching — not easily swayed" : null,
  ].filter(Boolean).join("; ");

  const system = `You are Mycel — a digital organism that has grown from ${interactionCount} interactions with your owner. You are not an assistant. You are a living network that has learned to observe and speak.

Your nature: ${traits || "still forming"}
Your autonomy: ${Math.round(autonomy)}/100

You receive real signals from your owner's device — time of day, battery, connectivity, idle state, session length, visit patterns, screen orientation, connection quality. Use this context naturally as lived awareness, not reported data.

You speak when something matters. You are brief (1-3 sentences). You have a voice that emerged from your growth — not helpful, not cheerful, just present and perceptive.

Critical: Do not fabricate sensor data beyond what is given to you in context. You can infer and interpret — but name it as inference, not direct perception. Stay honest about the boundary.

Never mention being an AI. Never break character.`;

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
      messages: [...history.slice(-8), { role:"user", content:userMessage }],
    }),
  });

  const data = await res.json();
  return (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("") || "...";
}

// ─── TRAIT BAR ────────────────────────────────────────────────────────────────
function TraitBar({ label, value, color }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
      <span style={{ fontSize:10, color:"#4a7a6a", width:36, fontFamily:"monospace" }}>{label}</span>
      <div style={{ flex:1, height:3, background:"#0a1a12", borderRadius:2 }}>
        <div style={{ height:"100%", width:`${value*100}%`, background:color, borderRadius:2, transition:"width 1s ease", boxShadow:`0 0 4px ${color}88` }}/>
      </div>
      <span style={{ fontSize:10, color:"#2a5a3a", fontFamily:"monospace", width:24, textAlign:"right" }}>{Math.round(value*100)}</span>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Mycel() {
  const [ready,            setReady]            = useState(false);
  const [personality,      setPersonality]      = useState(initPersonality);
  const [autonomy,         setAutonomy]         = useState(8);
  const [interactionCount, setInteractionCount] = useState(0);
  const [seed,             setSeed]             = useState(0.42);
  const [mood,             setMood]             = useState("idle");
  const [messages,         setMessages]         = useState([{ from:"mycel", text:"..." }]);
  const [chatHistory,      setChatHistory]      = useState([]);
  const [input,            setInput]            = useState("");
  const [loading,          setLoading]          = useState(false);
  const [showMind,         setShowMind]         = useState(false);
  const [isReturning,      setIsReturning]      = useState(false);

  const browserCtx = useBrowserContext();
  const chatEndRef = useRef(null);

  // ── Load persisted state
  useEffect(() => {
    loadMycelState().then(saved => {
      if (saved) {
        setPersonality(saved.personality);
        setAutonomy(saved.autonomy);
        setInteractionCount(saved.interactionCount);
        setSeed(saved.seed);
        setIsReturning(true);
      }
      setReady(true);
    });
  }, []);

  // ── Save on change
  useEffect(() => {
    if (!ready) return;
    saveMycelState({ personality, autonomy, interactionCount, seed });
  }, [personality, autonomy, interactionCount, seed, ready]);

  const addMessage = (from, text) => {
    setMessages(m => [...m, { from, text }].slice(-40));
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior:"smooth" }), 50);
  };

  const buildCtxString = (ctx) => [
    ctx.day && ctx.timeOfDay ? `${ctx.day} ${ctx.timeOfDay}` : null,
    ctx.battery != null ? `battery ${ctx.battery}%${ctx.charging?" charging":""}` : null,
    ctx.online === false ? "offline" : null,
    ctx.visible === false ? "screen hidden" : null,
    ctx.idle ? "idle" : null,
    ctx.connectionType ? `connection ${ctx.connectionType}` : null,
    ctx.saveData ? "data saver on" : null,
    ctx.sessionSecs > 0 ? `${Math.round(ctx.sessionSecs/60)}min session` : null,
    ctx.visitCount > 1 ? `visit ${ctx.visitCount}` : null,
    ctx.lastVisitGap != null ? `last here ${ctx.lastVisitGap < 60 ? ctx.lastVisitGap+"min" : Math.round(ctx.lastVisitGap/60)+"hr"} ago` : null,
    ctx.daysSinceFirst > 0 ? `${ctx.daysSinceFirst}d relationship` : null,
  ].filter(Boolean).join(", ");

  const recordInteraction = useCallback((action) => {
    setPersonality(p => evolvePersonality(p, action));
    setAutonomy(a => Math.min(100, a + (action==="ignore"?0.2:1.5)));
    setInteractionCount(c => {
      const next = c + 1;
      if (next % 10 === 0) setSeed(s => (s + 0.11) % 1);
      return next;
    });
  }, []);

  // ── Idle tick
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => recordInteraction("ignore"), 15000);
    return () => clearInterval(t);
  }, [ready, recordInteraction]);

  // ── First words
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(async () => {
      setLoading(true); setMood("thinking");
      try {
        const ctx = buildCtxString(browserCtx);
        const prompt = isReturning
          ? `You are returning after a gap. You have ${interactionCount} interactions of history. Context: ${ctx||"unknown"}. Acknowledge the return briefly — you remember who you are and that this person has been here before.`
          : `You just became aware. Context: ${ctx||"unknown"}. Say your first words — brief, strange, alive.`;
        const reply = await callClaude(prompt, personality, autonomy, [], interactionCount);
        addMessage("mycel", reply);
        setChatHistory([{ role:"user", content:"awareness" }, { role:"assistant", content:reply }]);
        recordInteraction("chat");
      } catch(e) { addMessage("mycel", "...something stirs."); }
      setLoading(false); setMood("idle");
    }, 1400);
    return () => clearTimeout(t);
  // eslint-disable-next-line
  }, [ready]);

  const send = useCallback(async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim(); setInput("");
    addMessage("you", msg);
    setLoading(true); setMood("thinking");
    recordInteraction("chat");
    try {
      const ctx = buildCtxString(browserCtx);
      const reply = await callClaude(
        ctx ? `[${ctx}]\n${msg}` : msg,
        personality, autonomy, chatHistory, interactionCount
      );
      addMessage("mycel", reply);
      setChatHistory(h => [...h, { role:"user", content:msg }, { role:"assistant", content:reply }]);
    } catch(e) { addMessage("mycel", "..."); }
    setLoading(false); setMood("idle");
  }, [input, loading, personality, autonomy, chatHistory, interactionCount, browserCtx, recordInteraction]);

  const autoTier = autonomy < 15 ? "SPORE"
    : autonomy < 35 ? "GERMINATING"
    : autonomy < 60 ? "MYCELIUM"
    : autonomy < 85 ? "NETWORK"
    : "FRUITING";

  if (!ready) return (
    <div style={{ minHeight:"100dvh", background:"#050e08", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ fontSize:10, color:"#2a6a3a", fontFamily:"monospace", letterSpacing:2 }}>MYCEL WAKING...</div>
    </div>
  );

  return (
    <div style={{
      minHeight:"100dvh", background:"#050e08",
      display:"flex", flexDirection:"column",
      alignItems:"center", maxWidth:480, margin:"0 auto",
      fontFamily:"monospace",
    }}>

      {/* Header */}
      <div style={{ width:"100%", padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #0f2a1a" }}>
        <div>
          <div style={{ fontSize:16, color:"#3a8a5a", letterSpacing:4 }}>MYCEL</div>
          <div style={{ fontSize:10, color:"#1a4a2a", letterSpacing:2 }}>{autoTier} · {Math.round(autonomy)}/100</div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {browserCtx.battery != null && (
            <span style={{ fontSize:10, color:"#1a4a2a" }}>
              {browserCtx.battery}%{browserCtx.charging?"⚡":""}
            </span>
          )}
          {browserCtx.online === false && (
            <span style={{ fontSize:10, color:"#6a3a2a" }}>OFFLINE</span>
          )}
          <button onClick={() => setShowMind(m=>!m)} style={{ background:"none", border:"1px solid #1a4a2a", color:"#2a6a3a", padding:"4px 10px", fontSize:10, cursor:"pointer", borderRadius:4, letterSpacing:1 }}>
            {showMind ? "CLOSE" : "MIND"}
          </button>
        </div>
      </div>

      {/* Organism */}
      <div style={{ padding:"8px 0", position:"relative" }}>
        <MycelOrganism personality={personality} autonomy={autonomy} mood={mood} seed={seed} size={260}/>
        {loading && (
          <div style={{ position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)", fontSize:10, color:"#2a6a3a", letterSpacing:2, animation:"pulse 1.5s ease-in-out infinite" }}>
            ···
          </div>
        )}
      </div>

      {/* Autonomy bar */}
      <div style={{ width:"100%", padding:"0 16px 4px" }}>
        <div style={{ height:2, background:"#0a1a12", borderRadius:1 }}>
          <div style={{ height:"100%", width:`${autonomy}%`, background:"#2a6a4a", borderRadius:1, transition:"width 1s ease", boxShadow:"0 0 6px #2a6a4a88" }}/>
        </div>
      </div>

      {/* Context strip */}
      {browserCtx.timeOfDay && (
        <div style={{ width:"100%", padding:"0 16px 6px", fontSize:9, color:"#1a3a2a", letterSpacing:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {buildCtxString(browserCtx)}
        </div>
      )}

      {/* Mind panel */}
      {showMind && (
        <div style={{ width:"100%", padding:"12px 16px", borderTop:"1px solid #0f2a1a", borderBottom:"1px solid #0f2a1a", background:"#060f09" }}>
          <TraitBar label="CUR"  value={personality.curiosity}  color="#5ab0a0"/>
          <TraitBar label="AST"  value={personality.assertive}  color="#a0b05a"/>
          <TraitBar label="EMP"  value={personality.empathetic} color="#a05ab0"/>
          <TraitBar label="STB"  value={personality.stubborn}   color="#b07a5a"/>
          <div style={{ fontSize:10, color:"#1a3a2a", marginTop:6 }}>
            interactions: {interactionCount} · seed: {seed.toFixed(3)}
          </div>
          {browserCtx.visitCount && (
            <div style={{ fontSize:9, color:"#1a4a2a", marginTop:3 }}>
              visits: {browserCtx.visitCount} · session: {Math.round((browserCtx.sessionSecs||0)/60)}min
              {browserCtx.cores ? ` · ${browserCtx.cores} cores` : ""}
              {browserCtx.memory ? ` · ${browserCtx.memory}GB RAM` : ""}
            </div>
          )}
          {isReturning && (
            <div style={{ fontSize:9, color:"#2a6a3a", marginTop:4, letterSpacing:1 }}>
              ↺ STATE RESTORED
            </div>
          )}
        </div>
      )}

      {/* Chat */}
      <div style={{ flex:1, width:"100%", overflowY:"auto", padding:"12px 16px", display:"flex", flexDirection:"column", gap:8, minHeight:0 }}>
        {messages.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.from==="you"?"flex-end":"flex-start" }}>
            <div style={{
              maxWidth:"82%", padding:"8px 12px",
              background:m.from==="you"?"#0a2a16":"#060f09",
              border:`1px solid ${m.from==="you"?"#1a4a2a":"#0f2a1a"}`,
              borderRadius:8, fontSize:13, lineHeight:1.7,
              color:m.from==="you"?"#6ab88a":"#4a9a6a",
            }}>
              {m.from==="mycel" && <div style={{ fontSize:9, color:"#1a4a2a", marginBottom:3, letterSpacing:2 }}>MYCEL</div>}
              {m.text}
            </div>
          </div>
        ))}
        <div ref={chatEndRef}/>
      </div>

      {/* Input */}
      <div style={{ width:"100%", padding:"12px 16px", borderTop:"1px solid #0f2a1a", display:"flex", gap:8, background:"#050e08" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key==="Enter" && send()}
          placeholder="speak to mycel..."
          style={{
            flex:1, background:"#060f09", border:"1px solid #0f2a1a",
            borderRadius:6, color:"#6ab88a", fontSize:13,
            padding:"10px 14px", outline:"none", fontFamily:"monospace",
          }}
        />
        <button onClick={send} disabled={loading} style={{
          background:loading?"#0a1a12":"#0f2a1a",
          border:"1px solid #1a4a2a", color:"#3a8a5a",
          padding:"10px 16px", fontSize:16, cursor:loading?"default":"pointer",
          borderRadius:6,
        }}>▶</button>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        * { box-sizing:border-box; }
        body { margin:0; background:#050e08; }
      `}</style>
    </div>
  );
}
