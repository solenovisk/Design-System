const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('\n❌  GEMINI_API_KEY não definida.');
  console.error('   Obtenha grátis em: https://aistudio.google.com/app/apikey');
  console.error('   PowerShell: $env:GEMINI_API_KEY="sua-chave"; node server.js\n');
  process.exit(1);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auto-detect best available model ──────────────────────────────────────────
const PREFERRED_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-pro-vision',
  'gemini-1.0-pro-vision-001',
];

let ACTIVE_MODEL = null;

async function detectModel() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) throw new Error(data.error.message);

  const available = (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''));

  console.log('\n📋 Modelos disponíveis nesta chave:');
  available.forEach(m => console.log('   •', m));

  for (const candidate of PREFERRED_MODELS) {
    if (available.includes(candidate)) return candidate;
  }

  // Fallback: pick first available with generateContent + vision (has "vision" or "flash" or "pro")
  const fallback = available.find(m => m.includes('flash') || m.includes('vision') || m.includes('pro'));
  if (fallback) return fallback;

  throw new Error(`Nenhum modelo compatível encontrado. Modelos disponíveis: ${available.join(', ')}`);
}

// ── Gemini REST streaming ──────────────────────────────────────────────────────
async function* streamGemini(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${ACTIVE_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const data = JSON.parse(json);
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch { /* skip malformed chunk */ }
    }
  }
}

// ── Prompts ────────────────────────────────────────────────────────────────────
const RULES = `IMPORTANT OUTPUT RULES:
- Return ONLY valid HTML starting with <!DOCTYPE html>. No markdown fences, no explanations.
- The file must be 100% self-contained: all CSS and JS inline, no external files.
- Google Fonts may be imported via @import inside a <style> tag.
- All interactive elements must work via embedded <script>.`;

const GENERATE_PROMPT = `You are a world-class UI/UX designer and frontend engineer.
Analyze the provided visual references and create a COMPLETE design system as a single self-contained HTML file.

${RULES}

The page must include these sections with a sticky sidebar for navigation:

1. Brand Overview — brand name and design philosophy
2. Color System — primary (5 shades), secondary (5 shades), semantic (success/warning/error/info), neutrals (9 shades). Each swatch: color block, name, hex, CSS var.
3. Typography — Google Font import, type scale Display XL to Caption, each with live example, size, weight, line-height
4. Spacing Scale — base-4 unit, visual bars from 4px to 128px
5. Border Radius — none/xs/sm/md/lg/xl/full with visual examples
6. Elevation/Shadows — 6 levels with card examples
7. Components (fully interactive):
   Buttons (Primary/Secondary/Outline/Ghost/Danger), Inputs, Textarea, Select, Checkbox, Radio, Toggle Switch,
   Badges, Alerts (info/success/warning/error), Cards, Navigation bar, Breadcrumbs, Progress bar, Tooltip, Modal, Avatar
8. Design Tokens Reference — CSS custom properties code block

VISUAL QUALITY: derive ALL colors and fonts from the references. On-brand design system style. Smooth CSS transitions. Responsive.`;

const MODIFY_PROMPT = (request, html) =>
  `You are a frontend engineer. Modify this design system HTML.

USER REQUEST: "${request}"

Apply ONLY the requested changes. Return the COMPLETE updated HTML.
${RULES}

Current HTML:
${html}`;

// ── Helpers ────────────────────────────────────────────────────────────────────
function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function stripFences(text) {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  return t;
}

async function extractUrlContext(url) {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DesignSystemBot/1.0)' },
    });
    const html = await res.text();
    const styles = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).slice(0, 3).join('\n').substring(0, 4000);
    const fonts = (html.match(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi) || []).join('\n');
    const theme = (html.match(/<meta[^>]*theme-color[^>]*>/i) || [''])[0];
    return `URL: ${url}\nHTML excerpt:\n${html.substring(0, 6000)}\nStyles:\n${styles}\nFonts: ${fonts}\nTheme: ${theme}`;
  } catch {
    return `URL: ${url} — Could not fetch. Use brand knowledge from the domain.`;
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────
app.post('/api/generate', upload.array('images', 10), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const urls = req.body.urls ? JSON.parse(req.body.urls) : [];
    const files = req.files || [];

    if (files.length === 0 && urls.length === 0) {
      sseWrite(res, { error: 'Adicione pelo menos uma imagem OU uma URL.' });
      return res.end();
    }

    const parts = [{ text: GENERATE_PROMPT }];

    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) continue;
      parts.push({ inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') } });
    }

    if (urls.length > 0) {
      sseWrite(res, { status: 'Buscando conteúdo das URLs...' });
      for (const url of urls) {
        parts.push({ text: await extractUrlContext(url) });
      }
    }

    sseWrite(res, { status: `Gerando design system com ${ACTIVE_MODEL}...` });

    let accumulated = '';
    for await (const chunk of streamGemini(parts)) {
      accumulated += chunk;
      sseWrite(res, { chunk });
    }

    sseWrite(res, { done: true, html: stripFences(accumulated) });
    res.end();
  } catch (err) {
    console.error('Generate error:', err.message);
    sseWrite(res, { error: err.message });
    res.end();
  }
});

app.post('/api/modify', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const { currentHtml, request } = req.body;
    if (!currentHtml || !request) {
      sseWrite(res, { error: 'Dados insuficientes.' });
      return res.end();
    }

    sseWrite(res, { status: 'Aplicando alterações...' });

    let accumulated = '';
    for await (const chunk of streamGemini([{ text: MODIFY_PROMPT(request, currentHtml) }])) {
      accumulated += chunk;
      sseWrite(res, { chunk });
    }

    sseWrite(res, { done: true, html: stripFences(accumulated) });
    res.end();
  } catch (err) {
    console.error('Modify error:', err.message);
    sseWrite(res, { error: err.message });
    res.end();
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

detectModel()
  .then(model => {
    ACTIVE_MODEL = model;
    console.log(`\n✅ Modelo selecionado: ${ACTIVE_MODEL}`);
    app.listen(PORT, () => {
      console.log(`✅ Design System Generator rodando em http://localhost:${PORT}\n`);
    }).on('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Porta ${PORT} ocupada. Use: $env:PORT=3001; node server.js\n`);
      }
      process.exit(1);
    });
  })
  .catch(err => {
    console.error('\n❌ Erro ao detectar modelo:', err.message, '\n');
    process.exit(1);
  });
