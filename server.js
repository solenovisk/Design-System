const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are a world-class UI/UX designer and frontend engineer specializing in design systems. Your job is to analyze visual references (images, screenshots, web pages) and produce a complete, beautiful, production-quality HTML design system documentation page.

IMPORTANT OUTPUT RULES:
- Return ONLY valid HTML. No markdown fences, no explanations, no prose before or after.
- The file must be 100% self-contained: all CSS and JS inline, no external files.
- Google Fonts may be imported via @import inside a <style> tag.
- All interactive elements (buttons, toggles, modals) must work via embedded <script>.`;

const GENERATE_PROMPT = `Analyze the provided visual references (images and/or web page content) and create a COMPLETE design system as a single self-contained HTML file.

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
6. **Elevation / Shadows** — 6 levels (none→2xl) as stacked cards
7. **Components** — fully interactive, pixel-perfect:
   - Buttons: Primary, Secondary, Outline, Ghost, Danger × Default/Hover/Disabled/Loading
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
- The design system itself must look on-brand
- Dark sidebar, clean section layout, subtle section dividers
- Smooth CSS transitions on all interactive elements
- Responsive (sidebar collapses on small screens)

OUTPUT: Return only the complete HTML file starting with <!DOCTYPE html>.`;

const MODIFY_PROMPT = (request) => `The user wants to modify the design system.

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

    // Extract styles
    const styleMatches = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [])
      .slice(0, 3)
      .join('\n')
      .substring(0, 4000);

    // Extract Google Fonts links
    const fontLinks = (html.match(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi) || []).join('\n');

    // Extract meta theme-color
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

app.post('/api/generate', upload.array('images', 10), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const urls = req.body.urls ? JSON.parse(req.body.urls) : [];
    const files = req.files || [];

    if (files.length === 0 && urls.length === 0) {
      sseWrite(res, { error: 'Please provide at least one image or URL.' });
      return res.end();
    }

    const content = [{ type: 'text', text: GENERATE_PROMPT }];

    for (const file of files) {
      const mediaType = file.mimetype;
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) continue;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: file.buffer.toString('base64') },
      });
    }

    sseWrite(res, { status: 'Fetching URL content...' });
    for (const url of urls) {
      const context = await extractUrlContext(url);
      content.push({ type: 'text', text: context });
    }

    sseWrite(res, { status: 'Generating design system...' });

    let accumulated = '';
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    stream.on('text', (text) => {
      accumulated += text;
      sseWrite(res, { chunk: text });
    });

    await stream.finalMessage();

    // Strip markdown fences if model wrapped in them
    let html = accumulated.trim();
    if (html.startsWith('```')) {
      html = html.replace(/^```[a-z]*\n?/, '').replace(/```\s*$/, '').trim();
    }

    sseWrite(res, { done: true, html });
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
      sseWrite(res, { error: 'Missing currentHtml or request.' });
      return res.end();
    }

    sseWrite(res, { status: 'Applying changes...' });

    let accumulated = '';
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Here is the current design system HTML:\n\n${currentHtml}\n\n${MODIFY_PROMPT(request)}`,
        },
      ],
    });

    stream.on('text', (text) => {
      accumulated += text;
      sseWrite(res, { chunk: text });
    });

    await stream.finalMessage();

    let html = accumulated.trim();
    if (html.startsWith('```')) {
      html = html.replace(/^```[a-z]*\n?/, '').replace(/```\s*$/, '').trim();
    }

    sseWrite(res, { done: true, html });
    res.end();
  } catch (err) {
    console.error('Modify error:', err);
    sseWrite(res, { error: err.message });
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Design System Generator running at http://localhost:${PORT}`);
});
