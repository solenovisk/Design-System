const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are a world-class UI/UX designer and frontend engineer specializing in design systems.

IMPORTANT OUTPUT RULES:
- Return ONLY valid HTML. No markdown fences, no explanations, no prose before or after.
- The file must be 100% self-contained: all CSS and JS inline, no external files.
- Google Fonts may be imported via @import inside a <style> tag.
- All interactive elements (buttons, toggles, modals) must work via embedded <script>.`;

const GENERATE_PROMPT = `${SYSTEM_PROMPT}

Analyze the provided visual references (images and/or web page content) and create a COMPLETE design system as a single self-contained HTML file.

The page must include these sections, navigable via a sticky sidebar:

1. **Brand Overview** — brand name, color story, design philosophy (inferred from references)
2. **Color System**
   - Primary palette: 5 swatches (50/100/300/600/900 shades)
   - Secondary palette: 5 swatches
   - Semantic: success, warning, error, info
   - Neutrals: 9 swatches (50–900)
   - Each swatch shows: color block, name, hex value, CSS variable
3. **Typography**
   - Font families used (import from Google Fonts if needed)
   - Type scale: Display XL, Display L, H1–H6, Body L/M/S, Caption, Code
   - Each row shows: live text example, size, weight, line-height, CSS var
4. **Spacing Scale** — base-4 unit system, visual ruler bars from 4px to 128px
5. **Border Radius** — none/xs/sm/md/lg/xl/full with visual rounded boxes
6. **Elevation / Shadows** — 6 levels (none to 2xl) as stacked cards
7. **Components** — fully interactive:
   - Buttons: Primary, Secondary, Outline, Ghost, Danger
   - Form elements: text input, textarea, select, checkbox, radio, toggle switch
   - Badges and Tags (multiple colors)
   - Alerts: info, success, warning, error
   - Cards: default, image header, interactive hover
   - Navigation bar (sample)
   - Breadcrumbs
   - Progress bar (animated)
   - Tooltip (hover to reveal)
   - Modal (click to open)
   - Avatar (initials + image variants)
8. **Design Tokens Reference** — scrollable code block with all CSS custom properties

VISUAL QUALITY:
- Derive ALL colors, fonts, visual style from the provided references
- Dark sidebar, clean section layout, subtle section dividers
- Smooth CSS transitions on all interactive elements
- Responsive (sidebar collapses on small screens)

OUTPUT: Return only the complete HTML file starting with <!DOCTYPE html>.`;

const MODIFY_PROMPT = (request) => `${SYSTEM_PROMPT}

Here is the current design system HTML:

USER REQUEST: "${request}"

Apply ONLY the requested changes. Keep everything else exactly the same.
Return the COMPLETE updated HTML file starting with <!DOCTYPE html>. No explanations, no markdown fences.`;

async function extractUrlContext(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DesignSystemBot/1.0)' },
    });
    clearTimeout(timeout);

    const html = await res.text();
    const excerpt = html.substring(0, 8000);
    const styleMatches = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [])
      .slice(0, 3).join('\n').substring(0, 4000);
    const fontLinks = (html.match(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi) || []).join('\n');
    const themeColor = (html.match(/<meta[^>]*theme-color[^>]*>/i) || [''])[0];

    return `URL: ${url}
Page HTML (first 8000 chars):
${excerpt}

Inline styles found:
${styleMatches}

Font links: ${fontLinks || 'none'}
Theme color meta: ${themeColor || 'none'}`;
  } catch {
    return `URL: ${url} — Could not fetch. Use knowledge of this brand/domain for style analysis.`;
  }
}

function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function stripFences(text) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z]*\n?/, '').replace(/```\s*$/, '').trim();
  }
  return t;
}

app.post('/api/generate', upload.array('images', 10), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const urls = req.body.urls ? JSON.parse(req.body.urls) : [];
    const files = req.files || [];

    if (files.length === 0 && urls.length === 0) {
      sseWrite(res, { error: 'Adicione pelo menos uma imagem ou URL.' });
      return res.end();
    }

    // Build Gemini parts
    const parts = [{ text: GENERATE_PROMPT }];

    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) continue;
      parts.push({ inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') } });
    }

    sseWrite(res, { status: 'Buscando conteúdo das URLs...' });
    for (const url of urls) {
      const context = await extractUrlContext(url);
      parts.push({ text: context });
    }

    sseWrite(res, { status: 'Gerando design system...' });

    let accumulated = '';
    const result = await model.generateContentStream(parts);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        accumulated += text;
        sseWrite(res, { chunk: text });
      }
    }

    sseWrite(res, { done: true, html: stripFences(accumulated) });
    res.end();
  } catch (err) {
    console.error('Generate error:', err);
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

    const parts = [
      { text: MODIFY_PROMPT(request) },
      { text: `Current HTML:\n\n${currentHtml}` },
    ];

    let accumulated = '';
    const result = await model.generateContentStream(parts);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        accumulated += text;
        sseWrite(res, { chunk: text });
      }
    }

    sseWrite(res, { done: true, html: stripFences(accumulated) });
    res.end();
  } catch (err) {
    console.error('Modify error:', err);
    sseWrite(res, { error: err.message });
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n✅  Design System Generator rodando em http://localhost:${PORT}\n`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Porta ${PORT} já está em uso.`);
    console.error(`   Tente outra porta: $env:PORT=3001; node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
