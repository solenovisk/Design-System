const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Provider detection ─────────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GROQ_KEY   = process.env.GROQ_API_KEY;

if (!GEMINI_KEY && !GROQ_KEY) {
  console.error(`
❌  Nenhuma API Key encontrada.

   Opção A — Groq (recomendado, grátis sem problemas):
     1. Acesse: https://console.groq.com/keys
     2. Crie uma conta e gere uma chave gratuita
     PowerShell: $env:GROQ_API_KEY="gsk_sua-chave"; node server.js

   Opção B — Gemini AI Studio (grátis):
     1. Acesse: https://aistudio.google.com/app/apikey
     2. Crie a chave DENTRO do AI Studio (não no Google Cloud)
     PowerShell: $env:GEMINI_API_KEY="AIza..."; node server.js
`);
  process.exit(1);
}

const PROVIDER = GROQ_KEY ? 'groq' : 'gemini';
console.log(`\n🔑 Usando provider: ${PROVIDER.toUpperCase()}`);

// ── Groq ───────────────────────────────────────────────────────────────────────
const GROQ_VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview',
];
let GROQ_MODEL = null;

async function detectGroqModel() {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const available = (data.data || []).map(m => m.id);
  console.log('\n📋 Modelos Groq disponíveis:');
  available.forEach(m => console.log('   •', m));
  for (const c of GROQ_VISION_MODELS) {
    if (available.includes(c)) return c;
  }
  // Fallback: any model with "llama" in name
  return available.find(m => m.toLowerCase().includes('llama')) || available[0];
}

async function* streamGroq(prompt, imageParts) {
  const content = [{ type: 'text', text: prompt }];
  for (const img of imageParts) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content }],
      max_tokens: 8192,
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq HTTP ${res.status}`);
  }

  yield* parseOpenAIStream(res);
}

// ── Gemini ─────────────────────────────────────────────────────────────────────
const GEMINI_PREFERRED = [
  'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro',
  'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-pro-vision',
];
let GEMINI_MODEL = null;

async function detectGeminiModel() {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const available = (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''));
  console.log('\n📋 Modelos Gemini disponíveis:');
  available.forEach(m => console.log('   •', m));
  for (const c of GEMINI_PREFERRED) {
    if (available.includes(c)) return c;
  }
  return available.find(m => m.includes('flash') || m.includes('pro')) || available[0];
}

async function* streamGemini(prompt, imageParts) {
  const parts = [{ text: prompt }];
  for (const img of imageParts) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
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
    throw new Error(err.error?.message || `Gemini HTTP ${res.status}`);
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
      try {
        const data = JSON.parse(line.slice(6));
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch { /* skip */ }
    }
  }
}

// ── OpenAI-compatible SSE parser (used by Groq) ───────────────────────────────
async function* parseOpenAIStream(res) {
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
      if (json === '[DONE]') return;
      try {
        const data = JSON.parse(json);
        const text = data.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch { /* skip */ }
    }
  }
}

// ── Unified stream ─────────────────────────────────────────────────────────────
function streamAI(prompt, imageParts = []) {
  return PROVIDER === 'groq'
    ? streamGroq(prompt, imageParts)
    : streamGemini(prompt, imageParts);
}

// ── Prompts ────────────────────────────────────────────────────────────────────
const RULES = `IMPORTANT OUTPUT RULES:
- Return ONLY valid HTML starting with <!DOCTYPE html>. No markdown fences, no prose.
- 100% self-contained: all CSS and JS inline, no external files except Google Fonts @import.
- All interactive elements must work via embedded <script>.`;

const GENERATE_PROMPT = `You are a world-class UI/UX designer. Analyze the visual references and create a COMPLETE design system as a single self-contained HTML file.

${RULES}

Include these sections with a sticky sidebar navigation:
1. Brand Overview — name and design philosophy
2. Color System — primary (5 shades), secondary (5 shades), semantic (success/warning/error/info), neutrals (9 shades). Each swatch: color block, name, hex, CSS variable.
3. Typography — Google Font, type scale Display XL to Caption with live examples
4. Spacing Scale — base-4 unit, visual bars 4px–128px
5. Border Radius — none/xs/sm/md/lg/xl/full
6. Elevation/Shadows — 6 levels on cards
7. Components (fully interactive): Buttons (5 variants), Inputs, Textarea, Select, Checkbox, Radio, Toggle, Badges, Alerts, Cards, Navigation bar, Breadcrumbs, Progress bar, Tooltip, Modal, Avatar
8. Design Tokens — CSS custom properties code block

Derive ALL colors and fonts from the references. Smooth transitions. Responsive layout.`;

const MODIFY_PROMPT = (request, html) =>
  `You are a frontend engineer. Modify this design system HTML per the user's request.

USER REQUEST: "${request}"

Apply ONLY the requested changes. Return the COMPLETE updated HTML.
${RULES}

Current HTML:
${html}`;

// ── Helpers ────────────────────────────────────────────────────────────────────
function sseWrite(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

function stripFences(t) {
  t = t.trim();
  if (t.startsWith('```')) t = t.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  return t;
}

async function extractUrlContext(url) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const styles = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).slice(0,3).join('\n').substring(0,4000);
    const fonts = (html.match(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi)||[]).join('\n');
    const theme = (html.match(/<meta[^>]*theme-color[^>]*>/i)||[''])[0];
    return `URL: ${url}\nHTML:\n${html.substring(0,6000)}\nStyles:\n${styles}\nFonts: ${fonts}\nTheme: ${theme}`;
  } catch {
    return `URL: ${url} — Could not fetch. Use brand knowledge from the domain name.`;
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

    let prompt = GENERATE_PROMPT;
    const imageParts = [];

    for (const file of files) {
      if (!['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)) continue;
      imageParts.push({ mimeType: file.mimetype, data: file.buffer.toString('base64') });
    }

    if (urls.length > 0) {
      sseWrite(res, { status: 'Buscando conteúdo das URLs...' });
      for (const url of urls) {
        prompt += '\n\n' + await extractUrlContext(url);
      }
    }

    const modelName = PROVIDER === 'groq' ? GROQ_MODEL : GEMINI_MODEL;
    sseWrite(res, { status: `Gerando design system com ${modelName}...` });

    let accumulated = '';
    for await (const chunk of streamAI(prompt, imageParts)) {
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
    if (!currentHtml || !request) { sseWrite(res, { error: 'Dados insuficientes.' }); return res.end(); }

    sseWrite(res, { status: 'Aplicando alterações...' });
    let accumulated = '';
    for await (const chunk of streamAI(MODIFY_PROMPT(request, currentHtml))) {
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

async function init() {
  if (PROVIDER === 'groq') {
    GROQ_MODEL = await detectGroqModel();
    console.log(`\n✅ Modelo selecionado: ${GROQ_MODEL}`);
  } else {
    GEMINI_MODEL = await detectGeminiModel();
    console.log(`\n✅ Modelo selecionado: ${GEMINI_MODEL}`);
  }

  app.listen(PORT, () => {
    console.log(`✅ Design System Generator rodando em http://localhost:${PORT}\n`);
  }).on('error', err => {
    if (err.code === 'EADDRINUSE')
      console.error(`\n❌ Porta ${PORT} ocupada. Use: $env:PORT=3001; node server.js\n`);
    process.exit(1);
  });
}

init().catch(err => {
  console.error('\n❌ Erro ao iniciar:', err.message, '\n');
  process.exit(1);
});
