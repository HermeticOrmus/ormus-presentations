const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8094;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'presentations.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS presentations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subtitle TEXT,
    client_name TEXT,
    client_logo_url TEXT,
    title_video_url TEXT,
    share_token TEXT UNIQUE,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','live','archived')),
    theme TEXT DEFAULT 'obsidian',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Migration: add title_video_url column to existing DBs (no-op if it already exists)
  -- SQLite doesn't have ALTER TABLE IF NOT EXISTS, so wrap in try/catch from JS
`);
try { db.exec(`ALTER TABLE presentations ADD COLUMN title_video_url TEXT`); } catch (e) { /* column exists */ }
db.exec(`

  CREATE TABLE IF NOT EXISTS slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    presentation_id INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    slide_type TEXT DEFAULT 'content' CHECK(slide_type IN ('title','content','stats','quote','list','comparison','cta')),
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
  );
`);

// --- Helpers ---
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function getPresentation(id) {
  const pres = db.prepare('SELECT * FROM presentations WHERE id = ?').get(id);
  if (!pres) return null;
  pres.slides = db.prepare('SELECT * FROM slides WHERE presentation_id = ? ORDER BY sort_order, id').all(id);
  return pres;
}

function getByToken(token) {
  const pres = db.prepare('SELECT * FROM presentations WHERE share_token = ?').get(token);
  if (!pres) return null;
  pres.slides = db.prepare('SELECT * FROM slides WHERE presentation_id = ? ORDER BY sort_order, id').all(pres.id);
  return pres;
}

// --- Middleware ---
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'static')));

// --- Health ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ormus-presentations', timestamp: new Date().toISOString() });
});

// --- Presentations CRUD ---
app.get('/api/presentations', (req, res) => {
  const list = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM slides WHERE presentation_id = p.id) as slide_count
    FROM presentations p ORDER BY p.updated_at DESC
  `).all();
  res.json(list);
});

app.get('/api/presentations/:id', (req, res) => {
  const pres = getPresentation(req.params.id);
  if (!pres) return res.status(404).json({ error: 'Not found' });
  res.json(pres);
});

app.post('/api/presentations', (req, res) => {
  const { title, subtitle, client_name, theme } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const token = generateToken();
  const result = db.prepare(
    'INSERT INTO presentations (title, subtitle, client_name, share_token, theme) VALUES (?, ?, ?, ?, ?)'
  ).run(title, subtitle || null, client_name || null, token, theme || 'obsidian');
  res.status(201).json(getPresentation(result.lastInsertRowid));
});

app.put('/api/presentations/:id', (req, res) => {
  const { title, subtitle, client_name, status, theme } = req.body;
  db.prepare(`
    UPDATE presentations SET title=COALESCE(?,title), subtitle=?, client_name=?,
    status=COALESCE(?,status), theme=COALESCE(?,theme), updated_at=datetime('now') WHERE id=?
  `).run(title || null, subtitle !== undefined ? subtitle : null,
    client_name !== undefined ? client_name : null, status || null, theme || null, req.params.id);
  res.json(getPresentation(req.params.id));
});

app.delete('/api/presentations/:id', (req, res) => {
  db.prepare('DELETE FROM slides WHERE presentation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM presentations WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// --- Slides CRUD ---
app.post('/api/presentations/:id/slides', (req, res) => {
  const { title, content, slide_type } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),-1) as m FROM slides WHERE presentation_id=?')
    .get(req.params.id);
  const result = db.prepare(
    'INSERT INTO slides (presentation_id, title, content, slide_type, sort_order) VALUES (?,?,?,?,?)'
  ).run(req.params.id, title || null, content || '', slide_type || 'content', maxOrder.m + 1);
  db.prepare("UPDATE presentations SET updated_at=datetime('now') WHERE id=?").run(req.params.id);
  res.status(201).json(db.prepare('SELECT * FROM slides WHERE id=?').get(result.lastInsertRowid));
});

app.put('/api/presentations/:presId/slides/:slideId', (req, res) => {
  const { title, content, slide_type, sort_order } = req.body;
  db.prepare(`
    UPDATE slides SET title=COALESCE(?,title), content=COALESCE(?,content),
    slide_type=COALESCE(?,slide_type), sort_order=COALESCE(?,sort_order) WHERE id=? AND presentation_id=?
  `).run(title !== undefined ? title : null, content !== undefined ? content : null,
    slide_type || null, sort_order !== undefined ? sort_order : null,
    req.params.slideId, req.params.presId);
  db.prepare("UPDATE presentations SET updated_at=datetime('now') WHERE id=?").run(req.params.presId);
  res.json(db.prepare('SELECT * FROM slides WHERE id=?').get(req.params.slideId));
});

app.delete('/api/presentations/:presId/slides/:slideId', (req, res) => {
  db.prepare('DELETE FROM slides WHERE id=? AND presentation_id=?').run(req.params.slideId, req.params.presId);
  db.prepare("UPDATE presentations SET updated_at=datetime('now') WHERE id=?").run(req.params.presId);
  res.json({ deleted: true });
});

// Reorder slides
app.put('/api/presentations/:id/reorder', (req, res) => {
  const { order } = req.body; // array of slide IDs in new order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
  const stmt = db.prepare('UPDATE slides SET sort_order=? WHERE id=? AND presentation_id=?');
  for (let i = 0; i < order.length; i++) {
    stmt.run(i, order[i], req.params.id);
  }
  res.json(getPresentation(req.params.id));
});

// --- Public assets (served under /view path so they're reachable from share links even when the rest of the app is auth-gated) ---
app.get('/view/assets/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, 'static', 'assets', filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// --- Pre-page (lobby/landing) ---
app.get('/view/:token', (req, res) => {
  const pres = getByToken(req.params.token);
  if (!pres) return res.status(404).send('Not found');

  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Categorize slides
  const slideTypes = {};
  pres.slides.forEach(s => {
    const t = s.slide_type;
    if (!slideTypes[t]) slideTypes[t] = 0;
    slideTypes[t]++;
  });

  // Estimate duration (1.5 min per slide, rough)
  const estMinutes = Math.ceil(pres.slides.length * 1.5);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(pres.title)} — Presentation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #0B0B0D;
  --surface: #111114;
  --surface2: #1a1a1f;
  --gold: #D29E3D;
  --gold-dim: #B8860B;
  --gold-glow: rgba(210,158,61,0.15);
  --parchment: #FAF6F0;
  --text-primary: rgba(250,246,240,0.92);
  --text-secondary: rgba(250,246,240,0.55);
  --text-muted: rgba(250,246,240,0.35);
  --border: rgba(250,246,240,0.08);
  --border-strong: rgba(250,246,240,0.16);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

* { margin:0; padding:0; box-sizing:border-box; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

body::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(250,246,240,0.008) 2px, rgba(250,246,240,0.008) 4px);
  pointer-events: none;
  z-index: 0;
}

body::before {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(ellipse at 30% 30%, rgba(210,158,61,0.06) 0%, transparent 50%),
              radial-gradient(ellipse at 70% 80%, rgba(210,158,61,0.03) 0%, transparent 40%);
  pointer-events: none;
}

.pre-page {
  position: relative;
  z-index: 1;
  max-width: 560px;
  width: 100%;
  padding: 40px;
  text-align: center;
  animation: fade-up 0.8s var(--ease-out) forwards;
  opacity: 0;
}

@keyframes fade-up {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}

.pre-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--gold);
  border: 1px solid rgba(210,158,61,0.3);
  padding: 5px 14px;
  border-radius: 4px;
  margin-bottom: 40px;
  text-transform: uppercase;
}

.pre-title {
  font-size: clamp(32px, 4.5vw, 48px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin-bottom: 16px;
  background: linear-gradient(135deg, var(--parchment) 30%, var(--gold) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.pre-subtitle {
  font-size: 16px;
  color: var(--text-secondary);
  font-weight: 300;
  margin-bottom: 48px;
  line-height: 1.6;
}

.pre-divider {
  width: 48px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--gold), transparent);
  margin: 0 auto 40px;
}

.pre-meta {
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-bottom: 48px;
}

.pre-meta-item {
  text-align: center;
}

.pre-meta-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--gold);
  letter-spacing: -0.02em;
}

.pre-meta-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 4px;
  font-weight: 500;
}

.pre-slides {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 48px;
  text-align: left;
}

.pre-slides-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 16px;
}

.pre-slide-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-secondary);
}

.pre-slide-item:last-child { border-bottom: none; }

.pre-slide-num {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: var(--surface2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  flex-shrink: 0;
}

.pre-slide-type {
  font-size: 10px;
  color: var(--gold-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-left: auto;
  flex-shrink: 0;
}

.pre-enter {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: 1px solid var(--gold-dim);
  color: var(--gold);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 14px 36px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s var(--ease-out);
  text-decoration: none;
}

.pre-enter:hover {
  background: var(--gold);
  color: var(--bg);
  box-shadow: 0 0 32px var(--gold-glow);
}

.pre-enter svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pre-footer {
  margin-top: 48px;
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 1px;
  text-transform: uppercase;
}

/* Keyboard hint */
.pre-hint {
  margin-top: 16px;
  font-size: 11px;
  color: var(--text-muted);
}

.pre-hint kbd {
  display: inline-block;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 10px;
  margin: 0 2px;
}
</style>
</head>
<body>

<div class="pre-page">
  <div class="pre-badge">Presentation</div>
  <h1 class="pre-title">${esc(pres.title)}</h1>
  ${pres.subtitle ? '<p class="pre-subtitle">' + esc(pres.subtitle) + '</p>' : ''}

  <div class="pre-divider"></div>

  <div class="pre-meta">
    <div class="pre-meta-item">
      <div class="pre-meta-value">${pres.slides.length}</div>
      <div class="pre-meta-label">Slides</div>
    </div>
    <div class="pre-meta-item">
      <div class="pre-meta-value">~${estMinutes}</div>
      <div class="pre-meta-label">Minutes</div>
    </div>
  </div>

  <div class="pre-slides">
    <div class="pre-slides-title">Overview</div>
    ${pres.slides.map((s, i) => `
      <div class="pre-slide-item">
        <div class="pre-slide-num">${i + 1}</div>
        <span>${esc(s.title || 'Untitled')}</span>
        <span class="pre-slide-type">${esc(s.slide_type)}</span>
      </div>
    `).join('')}
  </div>

  <a class="pre-enter" href="/view/${esc(req.params.token)}/present">
    Enter Presentation
    <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
  </a>

  <div class="pre-hint">
    Navigate with <kbd>&larr;</kbd> <kbd>&rarr;</kbd> or <kbd>Space</kbd>
  </div>

  <div class="pre-footer">${esc(pres.client_name || '')}</div>
</div>

</body>
</html>`;

  res.type('html').send(html);
});

// --- Full-screen Presentation ---
app.get('/view/:token/present', (req, res) => {
  const pres = getByToken(req.params.token);
  if (!pres) return res.status(404).send('Not found');

  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function renderMd(text) {
    if (!text) return '';
    let h = esc(text);
    h = h.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/(^|[\s>])((https?:\/\/)[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
    h = h.replace(/((<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');
    h = h.replace(/^\|(.+)\|$/gm, (match, inner) => {
      const cells = inner.split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      return '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
    });
    h = h.replace(/((<tr>.*<\/tr>\s*)+)/g, '<table>$1</table>');
    h = h.replace(/\n/g, '<br>');
    h = h.replace(/(<\/h[234]>)<br>/g, '$1');
    h = h.replace(/(<\/pre>)<br>/g, '$1');
    h = h.replace(/(<\/table>)<br>/g, '$1');
    h = h.replace(/(<\/ul>)<br>/g, '$1');
    h = h.replace(/(<\/li>)<br>/g, '$1');
    return h;
  }

  function parseStats(text) {
    if (!text) return [];
    return text.split('\n').filter(l => l.includes(':')).map(l => {
      const [label, ...rest] = l.split(':');
      return { label: label.trim(), value: rest.join(':').trim() };
    });
  }

  function parseComparison(text) {
    if (!text) return { headers: [], rows: [] };
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0] ? lines[0].split('|').map(s => s.trim()) : [];
    const rows = lines.slice(1).filter(l => !l.match(/^[-|:\s]+$/)).map(l => l.split('|').map(s => s.trim()));
    return { headers, rows };
  }

  function renderSlide(slide, index, total) {
    const t = slide.slide_type;
    let inner = '';

    if (t === 'title') {
      const brandBadge = pres.client_name ? `<div class="title-badge">${esc(pres.client_name)}</div>` : '';
      const videoBg = pres.title_video_url ? `
        <video class="slide-video-bg" autoplay muted loop playsinline>
          <source src="${esc(pres.title_video_url)}" type="video/mp4">
        </video>
        <div class="slide-video-overlay"></div>` : '';
      inner = `
        ${videoBg}
        <div class="slide-inner slide-title-content">
          ${brandBadge}
          ${slide.title ? '<h1>' + esc(slide.title) + '</h1>' : ''}
          ${slide.content ? '<p class="slide-subtitle">' + esc(slide.content) + '</p>' : ''}
          <div class="title-divider"></div>
        </div>`;
    } else if (t === 'stats') {
      const stats = parseStats(slide.content);
      inner = `
        <div class="slide-inner">
          <p class="slide-label">KEY METRICS</p>
          ${slide.title ? '<h2 class="slide-heading">' + esc(slide.title) + '</h2>' : ''}
          <div class="stats-grid">
            ${stats.map((s, i) => `<div class="stat-block" style="animation-delay:${i * 0.1}s">
              <div class="stat-ring"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="none" stroke="var(--surface2)" stroke-width="2"/><circle cx="40" cy="40" r="36" fill="none" stroke="var(--gold)" stroke-width="2" stroke-dasharray="226" stroke-dashoffset="${226 - (226 * (i + 1) / stats.length)}" stroke-linecap="round" transform="rotate(-90 40 40)" class="ring-progress"/></svg></div>
              <div class="stat-value">${esc(s.value)}</div>
              <div class="stat-label">${esc(s.label)}</div>
            </div>`).join('')}
          </div>
        </div>`;
    } else if (t === 'quote') {
      const lines = (slide.content || '').split('\n');
      const quote = lines[0] || '';
      const author = lines.slice(1).join('\n').trim() || '';
      inner = `
        <div class="slide-inner slide-quote-wrap">
          <div class="quote-line"></div>
          <blockquote>${esc(quote)}</blockquote>
          ${author ? '<cite>' + esc(author) + '</cite>' : ''}
        </div>`;
    } else if (t === 'comparison') {
      const comp = parseComparison(slide.content);
      inner = `
        <div class="slide-inner">
          ${slide.title ? '<h2 class="slide-heading">' + esc(slide.title) + '</h2>' : ''}
          <div class="comparison-table">
            <table>
              <thead><tr>${comp.headers.map(h => '<th>' + esc(h) + '</th>').join('')}</tr></thead>
              <tbody>${comp.rows.map((r, i) => '<tr style="animation-delay:' + (i * 0.05) + 's">' + r.map((c, ci) => '<td' + (ci === r.length - 1 ? ' class="td-accent"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('')}</tbody>
            </table>
          </div>
        </div>`;
    } else if (t === 'list') {
      inner = `
        <div class="slide-inner">
          ${slide.title ? '<h2 class="slide-heading">' + esc(slide.title) + '</h2>' : ''}
          <div class="slide-list">${renderMd(slide.content)}</div>
        </div>`;
    } else if (t === 'cta') {
      inner = `
        <div class="slide-inner slide-cta-wrap">
          ${slide.title ? '<h2 class="cta-heading">' + esc(slide.title) + '</h2>' : ''}
          ${slide.content ? '<div class="cta-body">' + renderMd(slide.content) + '</div>' : ''}
          <div class="cta-glow"></div>
        </div>`;
    } else {
      inner = `
        <div class="slide-inner">
          ${slide.title ? '<h2 class="slide-heading">' + esc(slide.title) + '</h2>' : ''}
          <div class="slide-body">${renderMd(slide.content)}</div>
        </div>`;
    }

    return `<section class="slide slide-${t}" data-index="${index}" style="display:${index === 0 ? 'flex' : 'none'}">${inner}</section>`;
  }

  const slidesHtml = pres.slides.map((s, i) => renderSlide(s, i, pres.slides.length)).join('\n');
  const total = pres.slides.length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<title>${esc(pres.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #0B0B0D;
  --surface: #111114;
  --surface2: #1a1a1f;
  --surface3: #222228;
  --gold: #D29E3D;
  --gold-dim: #B8860B;
  --gold-glow: rgba(210,158,61,0.15);
  --parchment: #FAF6F0;
  --text-primary: rgba(250,246,240,0.92);
  --text-secondary: rgba(250,246,240,0.55);
  --text-muted: rgba(250,246,240,0.35);
  --border: rgba(250,246,240,0.08);
  --border-strong: rgba(250,246,240,0.16);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 300ms;
  --duration-base: 500ms;
  --duration-slow: 800ms;
}

* { margin:0; padding:0; box-sizing:border-box; }

html, body {
  width: 100%; height: 100%;
  overflow: hidden;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Scan-line texture (Raven pattern) */
body::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(250,246,240,0.008) 2px,
    rgba(250,246,240,0.008) 4px
  );
  pointer-events: none;
  z-index: 100;
}

/* Slides — single at a time with fade */
.slide {
  position: fixed;
  top: 0; left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(32px, 5vw, 80px);
  overflow: hidden;
}

.slide::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(ellipse at 20% 40%, rgba(210,158,61,0.04) 0%, transparent 55%),
              radial-gradient(ellipse at 80% 70%, rgba(210,158,61,0.02) 0%, transparent 50%);
  pointer-events: none;
}

/* Slide inner — animation target */
.slide-inner {
  max-width: 900px;
  width: 100%;
  opacity: 0;
  transform: translateY(24px);
  transition: opacity var(--duration-base) var(--ease-out),
              transform var(--duration-base) var(--ease-out);
}

.slide.active .slide-inner {
  opacity: 1;
  transform: translateY(0);
}

.slide.exit .slide-inner {
  opacity: 0;
  transform: translateY(-12px);
  transition-duration: var(--duration-fast);
}

/* ===== SLIDE TYPES ===== */

/* Video background */
.slide-video-bg {
  position: absolute;
  top: 50%; left: 50%;
  min-width: 100%; min-height: 100%;
  width: auto; height: auto;
  transform: translate(-50%, -50%) scale(1.2);
  object-fit: cover;
  opacity: 0.2;
  z-index: 0;
  filter: saturate(0.8);
}

.slide-video-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(ellipse at center, transparent 30%, var(--bg) 80%);
  z-index: 1;
}

.slide-title .slide-inner { z-index: 2; position: relative; }

/* Title */
.slide-title { text-align: center; }
.slide-title-content { text-align: center; }

.title-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--gold);
  border: 1px solid var(--gold-dim);
  padding: 6px 16px;
  border-radius: 4px;
  margin-bottom: 40px;
}

.slide-title-content h1 {
  font-size: clamp(38px, 5.5vw, 72px);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.03em;
  margin-bottom: 24px;
  background: linear-gradient(135deg, var(--parchment) 30%, var(--gold) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.slide-subtitle {
  font-size: clamp(15px, 1.8vw, 20px);
  color: var(--text-secondary);
  font-weight: 300;
  line-height: 1.7;
  max-width: 500px;
  margin: 0 auto;
}

.title-divider {
  width: 48px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--gold), transparent);
  margin: 32px auto 0;
}

/* Label (category badge above heading) */
.slide-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: var(--gold);
  margin-bottom: 12px;
}

/* Heading */
.slide-heading {
  font-size: clamp(24px, 3.2vw, 38px);
  font-weight: 700;
  margin-bottom: 36px;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.slide-heading::after {
  content: '';
  display: block;
  width: 40px;
  height: 2px;
  background: var(--gold);
  margin-top: 16px;
}

/* Body & List */
.slide-body, .slide-list {
  font-size: clamp(14px, 1.3vw, 17px);
  line-height: 1.9;
  color: var(--text-secondary);
  max-width: 720px;
}

.slide-body strong, .slide-list strong {
  color: var(--text-primary);
  font-weight: 600;
}

.slide-body h2, .slide-list h2 { font-size: 22px; color: var(--gold); margin: 28px 0 12px; font-weight: 600; }
.slide-body h3, .slide-list h3 { font-size: 18px; color: var(--gold); margin: 22px 0 10px; font-weight: 600; }
.slide-body h4, .slide-list h4 { font-size: 15px; color: var(--gold); margin: 18px 0 8px; font-weight: 600; }

.slide-body ul, .slide-list ul {
  list-style: none;
  padding: 0;
}

.slide-body li, .slide-list li {
  padding: 10px 0 10px 20px;
  position: relative;
  font-size: clamp(14px, 1.2vw, 16px);
  border-left: 2px solid var(--border);
  margin-left: 0;
  transition: border-color var(--duration-fast) ease;
}

.slide.active .slide-body li, .slide.active .slide-list li {
  border-left-color: var(--gold-dim);
}

.slide-body li::before, .slide-list li::before {
  display: none;
}

.slide-body pre, .slide-list pre {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 16px;
  margin: 16px 0;
  font-size: 13px;
  overflow-x: auto;
}

.slide-body code, .slide-list code {
  background: var(--surface);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.88em;
}

/* Links */
.slide a, .slide-inner a {
  color: var(--gold);
  text-decoration: none;
  border-bottom: 1px solid rgba(210,158,61,0.3);
  transition: border-color var(--duration-fast) ease;
  cursor: pointer;
  position: relative;
  z-index: 10;
}

.slide a:hover, .slide-inner a:hover {
  border-bottom-color: var(--gold);
}

/* Tables */
.slide-body table, .slide-list table, .comparison-table table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
}

.slide-body th, .slide-list th, .comparison-table th {
  text-align: left;
  padding: 12px 20px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--gold);
  border-bottom: 1px solid var(--border-strong);
  font-weight: 600;
}

.slide-body td, .slide-list td, .comparison-table td {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  font-size: clamp(13px, 1.1vw, 15px);
  color: var(--text-secondary);
}

.td-accent {
  color: var(--gold) !important;
  font-weight: 600;
}

.comparison-table tr {
  transition: background var(--duration-fast) ease;
}

.comparison-table tr:hover td {
  background: rgba(210,158,61,0.04);
}

.comparison-table { max-width: 800px; width: 100%; }

/* Stats */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 20px;
  max-width: 800px;
  width: 100%;
}

.stat-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 32px 20px 28px;
  text-align: center;
  transition: border-color var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
  position: relative;
  overflow: hidden;
}

.stat-block::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--gold), transparent);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}

.stat-block:hover {
  border-color: var(--gold-dim);
  box-shadow: 0 0 24px var(--gold-glow);
}

.stat-block:hover::before { opacity: 1; }

.stat-ring {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
}

.stat-ring svg { width: 100%; height: 100%; }

.ring-progress {
  transition: stroke-dashoffset 1.2s var(--ease-out);
}

.stat-value {
  font-size: clamp(26px, 3vw, 36px);
  font-weight: 800;
  color: var(--gold);
  margin-bottom: 6px;
  letter-spacing: -0.03em;
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 500;
}

/* Quote */
.slide-quote-wrap {
  text-align: center;
  max-width: 680px;
}

.quote-line {
  width: 48px;
  height: 2px;
  background: var(--gold);
  margin: 0 auto 40px;
}

.slide-quote-wrap blockquote {
  font-size: clamp(22px, 2.8vw, 34px);
  font-weight: 300;
  line-height: 1.6;
  color: var(--text-primary);
  font-style: italic;
  position: relative;
  letter-spacing: -0.01em;
}

.slide-quote-wrap cite {
  display: block;
  margin-top: 32px;
  font-size: 13px;
  color: var(--gold);
  font-style: normal;
  letter-spacing: 1px;
  font-weight: 500;
  text-transform: uppercase;
}

/* CTA */
.slide-cta-wrap {
  text-align: center;
  max-width: 600px;
  position: relative;
}

.cta-heading {
  font-size: clamp(30px, 4.5vw, 54px);
  font-weight: 800;
  margin-bottom: 28px;
  letter-spacing: -0.03em;
  line-height: 1.1;
  background: linear-gradient(135deg, var(--parchment) 20%, var(--gold) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.cta-body {
  font-size: clamp(14px, 1.4vw, 18px);
  color: var(--text-secondary);
  line-height: 1.9;
}

.cta-body strong { color: var(--text-primary); font-weight: 600; }

.cta-glow {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, var(--gold-glow) 0%, transparent 70%);
  pointer-events: none;
  z-index: -1;
  animation: glow-pulse 4s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.7; transform: translate(-50%, -50%) scale(1.15); }
}

/* ===== CONTROLS ===== */

/* Progress indicator — top right */
.progress-indicator {
  position: fixed;
  top: 28px;
  right: 32px;
  z-index: 20;
  text-align: right;
  opacity: 1;
  transition: opacity var(--duration-fast) ease;
  pointer-events: none;
}

.progress-indicator.hidden { opacity: 0; }

.progress-current {
  font-size: 42px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  line-height: 1;
  opacity: 0.15;
  font-variant-numeric: tabular-nums;
}

.progress-total {
  font-size: 14px;
  font-weight: 400;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* Bottom controls bar */
.controls-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 28px;
  background: linear-gradient(transparent 0%, rgba(11,11,13,0.9) 40%);
  z-index: 20;
  opacity: 1;
  transform: translateY(0);
  transition: opacity var(--duration-fast) ease, transform var(--duration-fast) ease;
  pointer-events: none;
}

.controls-bar.hidden {
  opacity: 0;
  transform: translateY(100%);
}

.controls-bar > * { pointer-events: auto; }

.controls-brand {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.controls-center {
  display: flex;
  align-items: center;
  gap: 12px;
}

.controls-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
  font-size: 14px;
}

.controls-btn:hover:not(:disabled) {
  border-color: var(--gold-dim);
  color: var(--gold);
}

.controls-btn:disabled {
  opacity: 0.2;
  cursor: default;
}

.controls-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.controls-dots {
  display: flex;
  gap: 5px;
  align-items: center;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.dot.active {
  background: var(--gold);
  width: 18px;
  border-radius: 3px;
}

.controls-counter {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  min-width: 40px;
  text-align: right;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 768px) {
  .slide { padding: clamp(24px, 4vw, 40px); }
  .stats-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
  .stat-block { padding: 24px 16px; }
  .stat-ring { width: 48px; height: 48px; }
  .progress-indicator { top: 16px; right: 16px; }
  .progress-current { font-size: 28px; }
  .controls-bar { padding: 12px 16px; }
}

@media (max-width: 480px) {
  .stats-grid { grid-template-columns: 1fr; }
  .controls-dots { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
</head>
<body>

${slidesHtml}

<!-- Progress indicator (top-right) -->
<div class="progress-indicator" id="progress">
  <div class="progress-current" id="progress-num">1</div>
  <div class="progress-total">/ ${total}</div>
</div>

<!-- Controls bar (bottom) -->
<div class="controls-bar" id="controls">
  <div class="controls-brand">${esc(pres.client_name || '')}</div>
  <div class="controls-center">
    <button class="controls-btn" id="btn-prev" aria-label="Previous">
      <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="controls-dots" id="dots">
      ${pres.slides.map((_, i) => '<div class="dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '"></div>').join('')}
    </div>
    <button class="controls-btn" id="btn-next" aria-label="Next">
      <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>
  <div class="controls-counter"><span id="counter">1</span> / ${total}</div>
</div>

<script>
(function() {
  const slides = document.querySelectorAll('.slide');
  const dots = document.querySelectorAll('.dot');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const counter = document.getElementById('counter');
  const progressNum = document.getElementById('progress-num');
  const controls = document.getElementById('controls');
  const progress = document.getElementById('progress');
  const total = slides.length;
  let current = 0;
  let hideTimer = null;
  const HIDE_DELAY = 3000;
  let transitioning = false;

  function goTo(idx) {
    if (idx < 0 || idx >= total || idx === current || transitioning) return;
    transitioning = true;

    const prev = slides[current];
    const next = slides[idx];

    // Exit current
    prev.classList.remove('active');
    prev.classList.add('exit');

    // After exit animation
    setTimeout(() => {
      prev.style.display = 'none';
      prev.classList.remove('exit');

      // Enter next
      next.style.display = 'flex';
      // Force reflow
      next.offsetHeight;
      next.classList.add('active');

      current = idx;
      updateUI();
      transitioning = false;
    }, 280);
  }

  function updateUI() {
    const num = current + 1;
    counter.textContent = num;
    progressNum.textContent = num;
    btnPrev.disabled = current === 0;
    btnNext.disabled = current === total - 1;
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
    showControls();
  }

  function showControls() {
    controls.classList.remove('hidden');
    progress.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      controls.classList.add('hidden');
      progress.classList.add('hidden');
    }, HIDE_DELAY);
  }

  // Init first slide
  slides[0].classList.add('active');
  updateUI();

  // Keyboard
  document.addEventListener('keydown', e => {
    showControls();
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      goTo(current + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(total - 1);
    }
  });

  // Button clicks
  btnPrev.addEventListener('click', () => goTo(current - 1));
  btnNext.addEventListener('click', () => goTo(current + 1));

  // Dot clicks
  dots.forEach(dot => {
    dot.addEventListener('click', () => goTo(parseInt(dot.dataset.i)));
  });

  // Mouse/touch shows controls
  document.addEventListener('mousemove', showControls);
  document.addEventListener('touchstart', showControls);

  // Touch swipe support
  let touchStartX = 0;
  let touchStartY = 0;
  document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) goTo(current + 1);
      else goTo(current - 1);
    }
  }, { passive: true });
})();
</script>
</body>
</html>`;

  res.type('html').send(html);
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`ormus-presentations running on http://localhost:${PORT}`);
});
