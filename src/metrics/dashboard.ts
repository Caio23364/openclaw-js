/**
 * OpenClaw - Metrics Dashboard
 * Full-featured dashboard inspired by claw-dash & clawsuite
 */

import type { MetricsSnapshot } from './index.js';

export function generateDashboardHTML(snapshot: MetricsSnapshot, refreshInterval: number = 10): string {
  const s = snapshot;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const pct = (n: number) => n.toFixed(1);
  const usd = (n: number) => n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(2)}`;
  const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
  const uptimeStr = (() => {
    const sec = Math.floor(s.uptime / 1000);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();
  const trendIcon = (t: string) => t === 'increasing' ? '▲' : t === 'decreasing' ? '▼' : '—';
  const trendCls = (t: string) => t === 'increasing' ? 'trend-up' : t === 'decreasing' ? 'trend-down' : 'trend-flat';

  const hourlyLabels = JSON.stringify(s.messages.hourlyBreakdown.map(b => b.hour.split('T')[1] || b.hour));
  const hourlyMsgs = JSON.stringify(s.messages.hourlyBreakdown.map(b => b.count));
  const hourlyTokens = JSON.stringify(s.tokens.hourlyBreakdown.map(b => b.count));
  const dailyLabels = JSON.stringify(s.messages.dailyBreakdown.map(b => b.date));
  const dailyMsgs = JSON.stringify(s.messages.dailyBreakdown.map(b => b.count));
  const costDaily = JSON.stringify(s.costs.dailyBreakdown.map(b => b.cost || 0));
  const chNames = JSON.stringify(Object.keys(s.messages.byChannel));
  const chVals = JSON.stringify(Object.values(s.messages.byChannel));
  const prNames = JSON.stringify(Object.keys(s.providers.requests));
  const prVals = JSON.stringify(Object.values(s.providers.requests));

  const providerRows = Object.keys(s.providers.requests).map(p => {
    const avail = s.providers.availability[p] || 100;
    const lat = s.providers.avgLatency[p] || 0;
    const tok = s.providers.tokensByProvider[p] || { input: 0, output: 0 };
    return `<tr>
      <td><span class="provider-dot"></span>${p}</td>
      <td class="mono">${fmt(s.providers.requests[p] || 0)}</td>
      <td class="mono">${fmt(s.providers.errors[p] || 0)}</td>
      <td><div class="avail-bar"><div class="avail-fill" style="width:${avail}%"></div></div><span class="mono">${pct(avail)}%</span></td>
      <td class="mono">${lat.toFixed(0)}ms</td>
      <td class="mono">${fmt(tok.input)}</td>
      <td class="mono">${fmt(tok.output)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty-row">No provider data yet</td></tr>';

  const toolRows = Object.entries(s.tools.byTool).map(([name, t]) =>
    `<tr><td class="mono">${name}</td><td class="mono">${t.calls}</td><td class="mono">${pct(t.calls > 0 ? (t.success / t.calls) * 100 : 100)}%</td><td class="mono">${t.avgTime.toFixed(0)}ms</td></tr>`
  ).join('') || '<tr><td colspan="4" class="empty-row">No tool calls yet</td></tr>';


  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🦞 OpenClaw Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--font-sans:'Inter',system-ui,sans-serif;--font-mono:'JetBrains Mono',monospace}
[data-theme="dark"]{--bg-0:#06060b;--bg-1:#0d0d15;--bg-2:rgba(16,16,28,0.85);--bg-3:rgba(22,22,40,0.9);--border:rgba(255,255,255,0.06);--border-h:rgba(124,58,237,0.25);--text-0:#f4f4f8;--text-1:#a0a0bc;--text-2:#6a6a88;--accent:#7c3aed;--accent2:#06b6d4;--accent3:#10b981;--accent4:#f59e0b;--accent5:#f43f5e;--glass:rgba(124,58,237,0.06);--glow:0 0 60px rgba(124,58,237,0.08);--card-shadow:0 4px 24px rgba(0,0,0,0.3)}
[data-theme="light"]{--bg-0:#f5f5f7;--bg-1:#ffffff;--bg-2:rgba(255,255,255,0.9);--bg-3:rgba(248,248,252,0.95);--border:rgba(0,0,0,0.08);--border-h:rgba(124,58,237,0.2);--text-0:#1a1a2e;--text-1:#4a4a6a;--text-2:#8a8aa0;--accent:#7c3aed;--accent2:#0891b2;--accent3:#059669;--accent4:#d97706;--accent5:#e11d48;--glass:rgba(124,58,237,0.04);--glow:none;--card-shadow:0 2px 12px rgba(0,0,0,0.06)}
[data-theme="synthwave"]{--bg-0:#1a0533;--bg-1:#240845;--bg-2:rgba(36,8,69,0.9);--bg-3:rgba(48,12,88,0.85);--border:rgba(255,100,255,0.12);--border-h:rgba(255,50,200,0.3);--text-0:#fff0ff;--text-1:#cc88ee;--text-2:#8855aa;--accent:#ff36ab;--accent2:#00f0ff;--accent3:#ffee00;--accent4:#ff6b2b;--accent5:#ff3366;--glass:rgba(255,50,200,0.08);--glow:0 0 80px rgba(255,54,171,0.12);--card-shadow:0 4px 30px rgba(255,54,171,0.15)}
[data-theme="crt"]{--bg-0:#0a0a0a;--bg-1:#0f0f0f;--bg-2:rgba(15,15,15,0.95);--bg-3:rgba(20,20,20,0.9);--border:rgba(0,255,65,0.1);--border-h:rgba(0,255,65,0.3);--text-0:#00ff41;--text-1:#00cc33;--text-2:#008822;--accent:#00ff41;--accent2:#00cc33;--accent3:#33ff77;--accent4:#99ff00;--accent5:#ff3300;--glass:rgba(0,255,65,0.04);--glow:0 0 40px rgba(0,255,65,0.06);--card-shadow:0 0 20px rgba(0,255,65,0.08)}
[data-theme="hacker"]{--bg-0:#000000;--bg-1:#0a0a0a;--bg-2:rgba(10,10,10,0.95);--bg-3:rgba(15,15,15,0.9);--border:rgba(0,200,0,0.08);--border-h:rgba(0,255,0,0.2);--text-0:#00ff00;--text-1:#00cc00;--text-2:#007700;--accent:#00ff00;--accent2:#00dd00;--accent3:#33ff33;--accent4:#aaff00;--accent5:#ff0000;--glass:rgba(0,255,0,0.03);--glow:0 0 30px rgba(0,255,0,0.04);--card-shadow:0 0 15px rgba(0,255,0,0.06)}
body{font-family:var(--font-sans);background:var(--bg-0);color:var(--text-0);min-height:100vh;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 50% 40% at 20% 10%,var(--glass),transparent 70%),radial-gradient(ellipse 40% 30% at 80% 85%,rgba(6,182,212,0.04),transparent);pointer-events:none;z-index:0}
[data-theme="crt"] body::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(transparent,transparent 2px,rgba(0,0,0,0.15) 2px,rgba(0,0,0,0.15) 4px);pointer-events:none;z-index:999}
.wrap{position:relative;z-index:1;max-width:1480px;margin:0 auto;padding:16px 20px}
.mono{font-family:var(--font-mono);font-size:12px}

/* HEADER */
.hdr{display:flex;justify-content:space-between;align-items:center;padding:14px 22px;background:var(--bg-2);backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:14px;margin-bottom:20px;box-shadow:var(--glow)}
.hdr-left{display:flex;align-items:center;gap:14px}
.lobster{font-size:32px;animation:bob 3s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-5px) rotate(3deg)}}
.hdr h1{font-size:20px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hdr-sub{font-size:12px;color:var(--text-2)}
.hdr-right{display:flex;align-items:center;gap:10px}
.badge{padding:5px 12px;border-radius:99px;font-size:11px;font-weight:600;border:1px solid}
.badge-live{background:rgba(16,185,129,0.1);border-color:rgba(16,185,129,0.2);color:var(--accent3)}
.badge-live::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent3);margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.badge-up{background:var(--glass);border-color:var(--border);color:var(--text-1)}

/* THEME SWITCHER */
.themes{display:flex;gap:4px;background:var(--bg-3);border-radius:8px;padding:3px}
.themes button{background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px;font-size:14px;opacity:.6;transition:all .2s}
.themes button:hover{opacity:1;background:var(--glass)}
.themes button.active{opacity:1;background:var(--accent);color:#fff;box-shadow:0 2px 8px rgba(124,58,237,0.3)}

/* NAV TABS */
.nav{display:flex;gap:4px;margin-bottom:20px;background:var(--bg-2);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:12px;padding:4px;overflow-x:auto}
.nav button{background:none;border:none;color:var(--text-2);font-family:var(--font-sans);font-size:13px;font-weight:600;padding:8px 18px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:all .2s}
.nav button:hover{color:var(--text-0);background:var(--glass)}
.nav button.active{color:#fff;background:var(--accent);box-shadow:0 2px 12px rgba(124,58,237,0.25)}

/* PAGES */
.page{display:none}.page.show{display:block}

/* GRID */
.g{display:grid;gap:16px}.g2{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}.g5{grid-template-columns:repeat(5,1fr)}
@media(max-width:1100px){.g4,.g5{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.g2,.g3,.g4,.g5{grid-template-columns:1fr}.wrap{padding:10px}}

/* CARDS */
.c{background:var(--bg-2);backdrop-filter:blur(16px);border:1px solid var(--border);border-radius:12px;padding:20px;transition:all .25s;position:relative;overflow:hidden}
.c:hover{border-color:var(--border-h);transform:translateY(-1px);box-shadow:var(--card-shadow)}
.c-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--text-2);margin-bottom:10px;display:flex;align-items:center;gap:6px}
.c-val{font-size:28px;font-weight:800;letter-spacing:-1px;line-height:1;margin-bottom:4px}
.c-sub{font-size:12px;color:var(--text-1)}
.c-icon{font-size:16px}
.v1{color:var(--accent)}.v2{color:var(--accent2)}.v3{color:var(--accent3)}.v4{color:var(--accent4)}.v5{color:var(--accent5)}

/* SECTION */
.sec{font-size:14px;font-weight:700;margin:24px 0 12px;display:flex;align-items:center;gap:8px;color:var(--text-0)}
.sec::after{content:'';flex:1;height:1px;background:var(--border)}

/* TABLE */
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-2);padding:8px 10px;border-bottom:1px solid var(--border)}
.tbl td{padding:8px 10px;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.02);color:var(--text-1)}
.tbl tr:hover td{background:var(--glass)}
.empty-row{text-align:center;color:var(--text-2);padding:20px!important}

/* GAUGE */
.gauge{position:relative;width:100%;padding-top:50%;overflow:hidden}
.gauge svg{position:absolute;top:0;left:10%;width:80%;height:200%}
.gauge-label{position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:22px;font-weight:800;color:var(--text-0)}
.gauge-sub{position:absolute;bottom:-18px;left:0;right:0;text-align:center;font-size:10px;color:var(--text-2);text-transform:uppercase;letter-spacing:1px}

/* AVAIL BAR */
.avail-bar{width:60px;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;display:inline-block;vertical-align:middle;margin-right:6px}
.avail-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--accent3),var(--accent2))}
.provider-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent3);margin-right:8px}

/* ESTIMATION GRID */
.est-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.est{background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center;transition:all .2s}
.est:hover{border-color:var(--border-h);transform:translateY(-1px)}
.est-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.7px;color:var(--text-2);margin-bottom:6px}
.est-val{font-size:22px;font-weight:800;color:var(--accent)}
.est-trend{font-size:11px;margin-top:3px;color:var(--text-1)}
.trend-up{color:var(--accent5)}.trend-down{color:var(--accent3)}.trend-flat{color:var(--text-2)}
@media(max-width:640px){.est-grid{grid-template-columns:1fr}}

/* CHART */
.chart-wrap canvas{max-height:260px}

/* SYS GRID */
.sys-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.sys{text-align:center;padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid rgba(255,255,255,0.03)}
.sys-l{font-size:9px;text-transform:uppercase;letter-spacing:.7px;color:var(--text-2);margin-bottom:3px}
.sys-v{font-size:15px;font-weight:700;color:var(--accent2)}

/* FOOTER */
.ftr{text-align:center;margin-top:32px;padding:12px;font-size:11px;color:var(--text-2)}

/* FADE IN */
.fi{animation:fadeIn .4s ease both}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.fi:nth-child(1){animation-delay:.05s}.fi:nth-child(2){animation-delay:.1s}.fi:nth-child(3){animation-delay:.15s}.fi:nth-child(4){animation-delay:.2s}.fi:nth-child(5){animation-delay:.25s}

/* REFRESH INDICATOR */
.refresh-ring{width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite;display:none}
.refreshing .refresh-ring{display:block}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap">
<!-- HEADER -->
<header class="hdr fi">
  <div class="hdr-left">
    <span class="lobster" id="larry">🦞</span>
    <div><h1>OpenClaw Dashboard</h1><span class="hdr-sub">Real-time monitoring & usage estimation</span></div>
  </div>
  <div class="hdr-right">
    <div class="themes" id="themeSwitcher">
      <button onclick="setTheme('dark')" title="Dark">🌙</button>
      <button onclick="setTheme('light')" title="Light">☀️</button>
      <button onclick="setTheme('synthwave')" title="Synthwave">🌆</button>
      <button onclick="setTheme('crt')" title="CRT">📺</button>
      <button onclick="setTheme('hacker')" title="Hacker">💀</button>
    </div>
    <span class="badge badge-live">LIVE</span>
    <span class="badge badge-up">⏱ ${uptimeStr}</span>
    <div class="refresh-ring" id="refreshRing"></div>
  </div>
</header>

<!-- NAV -->
<nav class="nav fi" id="nav">
  <button class="active" onclick="showPage('overview')">📊 Overview</button>
  <button onclick="showPage('estimation')">🔮 Estimation</button>
  <button onclick="showPage('providers')">🤖 Providers</button>
  <button onclick="showPage('sessions')">💬 Sessions</button>
  <button onclick="showPage('gateway')">🌐 Gateway</button>
  <button onclick="showPage('tools')">🔧 Tools</button>
  <button onclick="showPage('system')">💻 System</button>
</nav>

<!-- ===== OVERVIEW PAGE ===== -->
<div class="page show" id="page-overview">
  <div class="g g5 fi">
    <div class="c"><div class="c-title"><span class="c-icon">💬</span>Messages</div><div class="c-val v1">${fmt(s.messages.total)}</div><div class="c-sub">${fmt(s.messages.received)} in · ${fmt(s.messages.sent)} out</div></div>
    <div class="c"><div class="c-title"><span class="c-icon">🪙</span>Tokens</div><div class="c-val v2">${fmt(s.tokens.total)}</div><div class="c-sub">${fmt(s.tokens.totalInput)} in · ${fmt(s.tokens.totalOutput)} out</div></div>
    <div class="c"><div class="c-title"><span class="c-icon">💵</span>Total Cost</div><div class="c-val v3">${usd(s.costs.totalUSD)}</div><div class="c-sub">${usd(s.costs.avgPerMessage)}/msg · ${usd(s.costs.avgPerDay)}/day</div></div>
    <div class="c"><div class="c-title"><span class="c-icon">📊</span>Sessions</div><div class="c-val v4">${s.sessions.active}</div><div class="c-sub">${s.sessions.totalCreated} total · peak ${s.estimation.peakConcurrentSessions}</div></div>
    <div class="c"><div class="c-title"><span class="c-icon">📡</span>Channels</div><div class="c-val v1">${s.channels.active}</div><div class="c-sub">${fmt(s.messages.failed)} failed msgs</div></div>
  </div>

  <div class="sec">📈 Activity</div>
  <div class="g g2 fi">
    <div class="c chart-wrap"><div class="c-title"><span class="c-icon">💬</span>Messages / Hour</div><canvas id="ch1"></canvas></div>
    <div class="c chart-wrap"><div class="c-title"><span class="c-icon">🪙</span>Tokens / Hour</div><canvas id="ch2"></canvas></div>
  </div>
  <div class="g g2 fi" style="margin-top:16px">
    <div class="c chart-wrap"><div class="c-title"><span class="c-icon">📅</span>Daily Messages</div><canvas id="ch3"></canvas></div>
    <div class="c chart-wrap"><div class="c-title"><span class="c-icon">💰</span>Daily Cost (USD)</div><canvas id="ch4"></canvas></div>
  </div>

  <div class="sec">🔄 Distribution</div>
  <div class="g g2 fi">
    <div class="c chart-wrap"><div class="c-title"><span class="c-icon">📡</span>By Channel</div><canvas id="ch5"></canvas></div>
    <div class="c chart-wrap"><div class="c-title"><span class="c-icon">🤖</span>By Provider</div><canvas id="ch6"></canvas></div>
  </div>
</div>

<!-- ===== ESTIMATION PAGE ===== -->
<div class="page" id="page-estimation">
  <div class="sec">🔮 Usage Estimation & Projections</div>
  <div class="c fi">
    <div class="est-grid">
      <div class="est"><div class="est-label">Messages / Hour</div><div class="est-val">${s.estimation.messagesPerHour}</div><div class="est-trend ${trendCls(s.estimation.messagesTrend)}">${trendIcon(s.estimation.messagesTrend)} ${s.estimation.messagesTrend}</div></div>
      <div class="est"><div class="est-label">Messages / Day</div><div class="est-val">${s.estimation.messagesPerDay}</div><div class="est-trend">~${fmt(s.estimation.projectedMessages30d)} / 30d</div></div>
      <div class="est"><div class="est-label">Messages / Month</div><div class="est-val">${fmt(s.estimation.messagesPerMonth)}</div><div class="est-trend ${trendCls(s.estimation.messagesTrend)}">${trendIcon(s.estimation.messagesTrend)} projected</div></div>
      <div class="est"><div class="est-label">Tokens / Hour</div><div class="est-val">${fmt(s.estimation.tokensPerHour)}</div><div class="est-trend ${trendCls(s.estimation.tokensTrend)}">${trendIcon(s.estimation.tokensTrend)} ${s.estimation.tokensTrend}</div></div>
      <div class="est"><div class="est-label">Tokens / Day</div><div class="est-val">${fmt(s.estimation.tokensPerDay)}</div><div class="est-trend">~${fmt(s.estimation.projectedTokens30d)} / 30d</div></div>
      <div class="est"><div class="est-label">Tokens / Month</div><div class="est-val">${fmt(s.estimation.tokensPerMonth)}</div><div class="est-trend ${trendCls(s.estimation.tokensTrend)}">${trendIcon(s.estimation.tokensTrend)} projected</div></div>
      <div class="est"><div class="est-label">Cost / Hour</div><div class="est-val">${usd(s.estimation.costPerHour)}</div><div class="est-trend ${trendCls(s.estimation.costTrend)}">${trendIcon(s.estimation.costTrend)} ${s.estimation.costTrend}</div></div>
      <div class="est"><div class="est-label">Cost / Day</div><div class="est-val">${usd(s.estimation.costPerDay)}</div><div class="est-trend">~${usd(s.estimation.projectedCost30d)} / 30d</div></div>
      <div class="est"><div class="est-label">Cost / Month</div><div class="est-val">${usd(s.estimation.costPerMonth)}</div><div class="est-trend ${trendCls(s.estimation.costTrend)}">${trendIcon(s.estimation.costTrend)} projected</div></div>
    </div>
  </div>
  <div class="g g3 fi" style="margin-top:16px">
    <div class="c"><div class="c-title">Active Sessions</div><div class="c-val v1">${s.estimation.activeSessions}</div></div>
    <div class="c"><div class="c-title">Peak Concurrent</div><div class="c-val v4">${s.estimation.peakConcurrentSessions}</div></div>
    <div class="c"><div class="c-title">Avg Session Lifetime</div><div class="c-val v2">${s.estimation.avgSessionLifetime > 0 ? (s.estimation.avgSessionLifetime / 60000).toFixed(1) + 'm' : '—'}</div></div>
  </div>
</div>

<!-- ===== PROVIDERS PAGE ===== -->
<div class="page" id="page-providers">
  <div class="sec">⚡ Provider Performance</div>
  <div class="c fi"><table class="tbl"><thead><tr><th>Provider</th><th>Requests</th><th>Errors</th><th>Availability</th><th>Latency</th><th>Input Tokens</th><th>Output Tokens</th></tr></thead><tbody>${providerRows}</tbody></table></div>
  <div class="sec">💰 Cost Breakdown</div>
  <div class="g g3 fi">
    ${Object.entries(s.costs.byProvider).map(([p, c]) => `<div class="c"><div class="c-title">${p}</div><div class="c-val v3">${usd(c)}</div></div>`).join('') || '<div class="c"><div class="empty-row">No cost data</div></div>'}
  </div>
  <div class="sec">🏷️ Cost by Model</div>
  <div class="g g3 fi">
    ${Object.entries(s.costs.byModel).map(([m, c]) => `<div class="c"><div class="c-title mono">${m}</div><div class="c-val v2">${usd(c)}</div></div>`).join('') || '<div class="c"><div class="empty-row">No model data</div></div>'}
  </div>
</div>

<!-- ===== SESSIONS PAGE ===== -->
<div class="page" id="page-sessions">
  <div class="g g4 fi">
    <div class="c"><div class="c-title">Total Created</div><div class="c-val v1">${s.sessions.totalCreated}</div></div>
    <div class="c"><div class="c-title">Active Now</div><div class="c-val v3">${s.sessions.active}</div></div>
    <div class="c"><div class="c-title">Avg Duration</div><div class="c-val v2">${s.sessions.avgDuration > 0 ? (s.sessions.avgDuration / 60000).toFixed(1) + 'm' : '—'}</div></div>
    <div class="c"><div class="c-title">Avg Msgs/Session</div><div class="c-val v4">${s.sessions.avgMessagesPerSession.toFixed(1)}</div></div>
  </div>
  <div class="sec">📡 Sessions by Channel</div>
  <div class="g g4 fi">
    ${Object.entries(s.sessions.byChannel).map(([ch, n]) => `<div class="c"><div class="c-title">${ch}</div><div class="c-val v1">${n}</div></div>`).join('') || '<div class="c"><div class="empty-row">No session data</div></div>'}
  </div>
  <div class="sec">👥 Active Users by Channel</div>
  <div class="g g4 fi">
    ${Object.entries(s.channels.activeUsers).map(([ch, n]) => `<div class="c"><div class="c-title">${ch}</div><div class="c-val v2">${n}</div></div>`).join('') || '<div class="c"><div class="empty-row">No user data</div></div>'}
  </div>
</div>

<!-- ===== GATEWAY PAGE ===== -->
<div class="page" id="page-gateway">
  <div class="g g4 fi">
    <div class="c"><div class="c-title">WS Connections</div><div class="c-val v1">${s.gateway.wsConnections}</div><div class="c-sub">peak: ${s.gateway.peakConnections}</div></div>
    <div class="c"><div class="c-title">WS Messages</div><div class="c-val v2">${fmt(s.gateway.wsMessagesReceived + s.gateway.wsMessagesSent)}</div><div class="c-sub">${fmt(s.gateway.wsMessagesReceived)} in · ${fmt(s.gateway.wsMessagesSent)} out</div></div>
    <div class="c"><div class="c-title">HTTP Requests</div><div class="c-val v3">${fmt(s.gateway.httpRequests)}</div><div class="c-sub">${s.gateway.httpErrors} errors</div></div>
    <div class="c"><div class="c-title">Avg Response</div><div class="c-val v4">${s.gateway.avgResponseTime.toFixed(0)}ms</div></div>
  </div>
</div>

<!-- ===== TOOLS PAGE ===== -->
<div class="page" id="page-tools">
  <div class="g g3 fi">
    <div class="c"><div class="c-title">Total Calls</div><div class="c-val v1">${fmt(s.tools.totalCalls)}</div></div>
    <div class="c"><div class="c-title">Success Rate</div><div class="c-val v3">${pct(s.tools.successRate)}%</div><div class="avail-bar" style="width:100%;margin-top:8px"><div class="avail-fill" style="width:${s.tools.successRate}%"></div></div></div>
    <div class="c"><div class="c-title">Avg Execution</div><div class="c-val v2">${s.tools.avgExecutionTime.toFixed(0)}ms</div></div>
  </div>
  <div class="sec">🔧 Per-Tool Breakdown</div>
  <div class="c fi"><table class="tbl"><thead><tr><th>Tool</th><th>Calls</th><th>Success</th><th>Avg Time</th></tr></thead><tbody>${toolRows}</tbody></table></div>
</div>

<!-- ===== SYSTEM PAGE ===== -->
<div class="page" id="page-system">
  <div class="g g3 fi">
    <div class="c" style="text-align:center">
      <div class="c-title" style="justify-content:center"><span class="c-icon">🔥</span>CPU Usage</div>
      <div class="gauge">
        <svg viewBox="0 0 200 100">
          <path d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="10" stroke-linecap="round"/>
          <path d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke="url(#cpuGrad)" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="${Math.PI * 80}" stroke-dashoffset="${Math.PI * 80 * (1 - s.resources.cpuPercent / 100)}"
            style="transition:stroke-dashoffset .8s ease"/>
          <defs><linearGradient id="cpuGrad"><stop offset="0%" stop-color="#10b981"/><stop offset="50%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#f43f5e"/></linearGradient></defs>
        </svg>
        <div class="gauge-label">${pct(s.resources.cpuPercent)}%</div>
      </div>
      <div class="c-sub" style="margin-top:16px">Avg: ${pct(s.resources.avgCpuPercent)}% · Peak: ${pct(s.resources.peakCpuPercent)}%</div>
      <div class="c-sub ${trendCls(s.resources.cpuTrend)}">${trendIcon(s.resources.cpuTrend)} ${s.resources.cpuTrend}</div>
    </div>
    <div class="c" style="text-align:center">
      <div class="c-title" style="justify-content:center"><span class="c-icon">🧠</span>OS Memory</div>
      <div class="gauge">
        <svg viewBox="0 0 200 100">
          <path d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="10" stroke-linecap="round"/>
          <path d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke="url(#memGrad)" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="${Math.PI * 80}" stroke-dashoffset="${Math.PI * 80 * (1 - s.resources.osMemoryPercent / 100)}"
            style="transition:stroke-dashoffset .8s ease"/>
          <defs><linearGradient id="memGrad"><stop offset="0%" stop-color="#06b6d4"/><stop offset="50%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#f43f5e"/></linearGradient></defs>
        </svg>
        <div class="gauge-label">${pct(s.resources.osMemoryPercent)}%</div>
      </div>
      <div class="c-sub" style="margin-top:16px">${fmt(s.resources.osUsedMemoryMB)} / ${fmt(s.resources.osTotalMemoryMB)} MB</div>
      <div class="c-sub ${trendCls(s.resources.memoryTrend)}">${trendIcon(s.resources.memoryTrend)} ${s.resources.memoryTrend}</div>
    </div>
    <div class="c" style="text-align:center">
      <div class="c-title" style="justify-content:center"><span class="c-icon">📦</span>Heap Memory</div>
      <div class="gauge">
        <svg viewBox="0 0 200 100">
          <path d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="10" stroke-linecap="round"/>
          <path d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke="url(#heapGrad)" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="${Math.PI * 80}" stroke-dashoffset="${Math.PI * 80 * (1 - s.resources.heapPercent / 100)}"
            style="transition:stroke-dashoffset .8s ease"/>
          <defs><linearGradient id="heapGrad"><stop offset="0%" stop-color="#10b981"/><stop offset="50%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#f43f5e"/></linearGradient></defs>
        </svg>
        <div class="gauge-label">${pct(s.resources.heapPercent)}%</div>
      </div>
      <div class="c-sub" style="margin-top:16px">${pct(s.resources.heapUsedMB)} / ${pct(s.resources.heapTotalMB)} MB</div>
      <div class="c-sub ${trendCls(s.resources.heapTrend)}">${trendIcon(s.resources.heapTrend)} ${s.resources.heapTrend}</div>
    </div>
  </div>

  <div class="sec">📈 Resource History (last ~10 min)</div>
  <div class="g g2 fi">
    <div class="c chart-wrap"><div class="c-title"><span class="c-icon">🔥</span>CPU % Over Time</div><canvas id="chCpu"></canvas></div>
    <div class="c chart-wrap"><div class="c-title"><span class="c-icon">🧠</span>Memory % Over Time</div><canvas id="chMem"></canvas></div>
  </div>

  <div class="sec">📊 Resource Details</div>
  <div class="g g4 fi">
    <div class="c"><div class="c-title">Process RSS</div><div class="c-val v2">${pct(s.resources.memoryUsedMB)} MB</div><div class="c-sub">Peak: ${pct(s.resources.peakMemoryMB)} MB</div></div>
    <div class="c"><div class="c-title">Load Average</div><div class="c-val v4">${s.resources.loadAvg[0]}</div><div class="c-sub">5m: ${s.resources.loadAvg[1]} · 15m: ${s.resources.loadAvg[2]}</div></div>
    <div class="c"><div class="c-title">CPU Cores</div><div class="c-val v1">${s.resources.cpuCount}</div><div class="c-sub mono" style="font-size:10px">${s.resources.cpuModel.substring(0, 30)}</div></div>
    <div class="c"><div class="c-title">OS Free Memory</div><div class="c-val v3">${fmt(s.resources.osFreeMemoryMB)} MB</div><div class="c-sub">${fmt(s.resources.osTotalMemoryMB)} MB total</div></div>
  </div>

  <div class="sec">🔮 Resource Projections</div>
  <div class="g g3 fi">
    <div class="c"><div class="c-title">Memory Growth</div><div class="c-val ${s.resources.memoryGrowthMBPerHour > 1 ? 'v5' : s.resources.memoryGrowthMBPerHour > 0 ? 'v4' : 'v3'}">${s.resources.memoryGrowthMBPerHour > 0 ? '+' : ''}${pct(s.resources.memoryGrowthMBPerHour)} MB/h</div><div class="c-sub">${s.resources.memoryGrowthMBPerHour <= 0 ? '✅ Stable or decreasing' : '⚠️ Memory is growing'}</div></div>
    <div class="c"><div class="c-title">Estimated OOM</div><div class="c-val ${s.resources.estimatedOOMHours !== null && s.resources.estimatedOOMHours < 24 ? 'v5' : 'v3'}">${s.resources.estimatedOOMHours !== null ? s.resources.estimatedOOMHours + 'h' : '∞'}</div><div class="c-sub">${s.resources.estimatedOOMHours !== null ? (s.resources.estimatedOOMHours < 24 ? '🔴 Critical — less than 24h' : s.resources.estimatedOOMHours < 72 ? '🟡 Warning — monitor closely' : '🟢 Healthy') : '🟢 No memory leak detected'}</div></div>
    <div class="c"><div class="c-title">Avg Heap Usage</div><div class="c-val v2">${pct(s.resources.avgHeapPercent)}%</div><div class="c-sub">Peak: ${pct(s.resources.peakHeapMB)} MB</div></div>
  </div>

  <div class="sec">⚙️ Runtime Info</div>
  <div class="c fi">
    <div class="sys-grid">
      <div class="sys"><div class="sys-l">Node</div><div class="sys-v">${s.system.nodeVersion}</div></div>
      <div class="sys"><div class="sys-l">Platform</div><div class="sys-v">${s.system.platform}</div></div>
      <div class="sys"><div class="sys-l">Arch</div><div class="sys-v">${s.system.arch}</div></div>
      <div class="sys"><div class="sys-l">Process Uptime</div><div class="sys-v">${Math.floor(s.system.uptime / 60)}m</div></div>
      <div class="sys"><div class="sys-l">External Mem</div><div class="sys-v">${mb(s.system.memoryUsage.external)} MB</div></div>
      <div class="sys"><div class="sys-l">ArrayBuffers</div><div class="sys-v">${mb(s.system.memoryUsage.arrayBuffers)} MB</div></div>
    </div>
  </div>
</div>

<div class="ftr fi">🦞 OpenClaw Dashboard · Updated: <span id="lastUpdate">${new Date(s.timestamp).toLocaleString()}</span> · Refresh: ${refreshInterval}s</div>
</div>

<script>
// Theme
function setTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('oc-theme',t);document.querySelectorAll('.themes button').forEach((b,i)=>{b.classList.toggle('active',['dark','light','synthwave','crt','hacker'][i]===t)})}
(()=>{const t=localStorage.getItem('oc-theme')||'dark';setTheme(t)})();

// Navigation
function showPage(id){document.querySelectorAll('.page').forEach(p=>p.classList.remove('show'));document.getElementById('page-'+id)?.classList.add('show');document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));event?.target?.classList.add('active')}

// Chart setup
Chart.defaults.color=getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim()||'#6a6a88';
Chart.defaults.borderColor='rgba(255,255,255,0.04)';
Chart.defaults.font.family="'Inter',sans-serif";
Chart.defaults.font.size=10;
const mkGrad=(ctx,c1,c2)=>{const g=ctx.chart.ctx.createLinearGradient(0,0,0,ctx.chart.height);g.addColorStop(0,c1);g.addColorStop(1,c2);return g};
const lineOpts={responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{maxTicksLimit:10}},y:{beginAtZero:true,grid:{color:'rgba(255,255,255,0.03)'}}},interaction:{intersect:false,mode:'index'},animation:{duration:800}};
const mkLine=(el,labels,data,color,g1,g2)=>new Chart(el,{type:'line',data:{labels,datasets:[{data,borderColor:color,backgroundColor:ctx=>mkGrad(ctx,g1,g2),borderWidth:2,fill:true,tension:.4,pointRadius:1.5,pointHoverRadius:4,pointBackgroundColor:color}]},options:lineOpts});

mkLine(document.getElementById('ch1'),${hourlyLabels},${hourlyMsgs},'#a78bfa','rgba(124,58,237,0.35)','rgba(124,58,237,0.02)');
mkLine(document.getElementById('ch2'),${hourlyLabels},${hourlyTokens},'#67e8f9','rgba(6,182,212,0.35)','rgba(6,182,212,0.02)');

new Chart(document.getElementById('ch3'),{type:'bar',data:{labels:${dailyLabels},datasets:[{data:${dailyMsgs},backgroundColor:'rgba(124,58,237,0.45)',borderColor:'#7c3aed',borderWidth:1,borderRadius:5,maxBarThickness:36}]},options:{...lineOpts}});

mkLine(document.getElementById('ch4'),${dailyLabels},${costDaily},'#6ee7b7','rgba(16,185,129,0.35)','rgba(16,185,129,0.02)');

const dColors=['#7c3aed','#06b6d4','#10b981','#f59e0b','#f43f5e','#ec4899','#8b5cf6'];
const donutOpts={responsive:true,cutout:'68%',plugins:{legend:{position:'bottom',labels:{padding:14,usePointStyle:true,pointStyleWidth:8,font:{size:11}}}},animation:{animateRotate:true,duration:1000}};
new Chart(document.getElementById('ch5'),{type:'doughnut',data:{labels:${chNames},datasets:[{data:${chVals},backgroundColor:dColors,borderWidth:0,hoverOffset:6}]},options:donutOpts});
new Chart(document.getElementById('ch6'),{type:'doughnut',data:{labels:${prNames},datasets:[{data:${prVals},backgroundColor:['#06b6d4','#f59e0b','#10b981','#7c3aed'],borderWidth:0,hoverOffset:6}]},options:donutOpts});

// Resource sparklines
const cpuHist = ${JSON.stringify(s.resources.cpuHistory)};
const memHist = ${JSON.stringify(s.resources.memoryHistory)};
const resLabels = cpuHist.map((_,i) => '');
if(document.getElementById('chCpu')){mkLine(document.getElementById('chCpu'),resLabels,cpuHist,'#f59e0b','rgba(245,158,11,0.3)','rgba(245,158,11,0.02)');}
if(document.getElementById('chMem')){mkLine(document.getElementById('chMem'),resLabels,memHist,'#a78bfa','rgba(167,139,250,0.3)','rgba(167,139,250,0.02)');}

// Auto refresh via fetch
${refreshInterval > 0 ? `setInterval(async()=>{try{document.body.classList.add('refreshing');const r=await fetch('/api/metrics/dashboard?refresh=${refreshInterval}');if(r.ok){const html=await r.text();const parser=new DOMParser();const doc=parser.parseFromString(html,'text/html');const newWrap=doc.querySelector('.wrap');if(newWrap){document.querySelector('.wrap').innerHTML=newWrap.innerHTML}document.getElementById('lastUpdate').textContent=new Date().toLocaleString()}}catch(e){}finally{document.body.classList.remove('refreshing')}},${refreshInterval * 1000});` : ''}
<\/script>
</body>
</html>`;
}
