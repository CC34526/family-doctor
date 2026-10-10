import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_MODEL = 'chat-latest';
const MODELS = ['chat-latest', 'gpt-5.6-sol', 'gpt-5.6-luna'];

const SUBJECTS = {
  me: 'the adult using this chat',
  child: 'a child in the household',
  partner: 'their partner',
  parent: 'an older parent or grandparent',
  other: 'another person in the household',
};

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/status', (_req, res) => {
  res.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: currentModel(),
    models: MODELS,
  });
});

app.post('/api/key', async (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim();
  const remember = Boolean(req.body?.remember);
  const model = chooseModel(req.body?.model);
  const hasKey = Boolean(process.env.OPENAI_API_KEY);

  if (!apiKey && !hasKey) {
    return res.status(400).json({ error: 'Paste the API key from your OpenAI account.' });
  }
  if (apiKey && !isPlausibleKey(apiKey)) {
    return res.status(400).json({ error: 'That does not look like an OpenAI API key.' });
  }

  if (apiKey) {
    try {
      const client = new OpenAI({ apiKey });
      await client.models.list();
    } catch (error) {
      const status = error?.status === 401 ? 401 : 502;
      const message = error?.status === 401
        ? 'OpenAI did not accept that API key.'
        : 'Could not reach OpenAI to check the key. Try again.';
      return res.status(status).json({ error: message });
    }
    process.env.OPENAI_API_KEY = apiKey;
  }

  process.env.OPENAI_MODEL = model;

  let remembered = false;
  let warning = '';
  if (remember) {
    try {
      const values = { OPENAI_MODEL: model };
      if (apiKey) values.OPENAI_API_KEY = apiKey;
      writeEnvValues(values);
      remembered = true;
    } catch {
      warning = 'The key works for this session, but it could not be saved on this computer.';
    }
  }

  res.json({
    configured: true,
    remembered,
    model,
    warning,
  });
});

app.post('/api/chat', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(400).json({ error: 'Add your OpenAI API key before starting a visit.' });
  }

  const messages = sanitizeMessages(req.body?.messages);
  const about = sanitizeAbout(req.body?.about);
  if (!messages.length || messages.at(-1).role !== 'user') {
    return res.status(400).json({ error: 'Type a question to start the visit.' });
  }

  const model = currentModel();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let stream;
  try {
    stream = await client.chat.completions.create({
      model,
      store: false,
      stream: true,
      max_completion_tokens: 2000,
      ...(usesReasoning(model)
        ? { reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'low' }
        : {}),
      messages: [
        { role: instructionRole(model), content: buildPrompt(about) },
        ...messages,
      ],
    });
  } catch (error) {
    const message = friendlyError(error);
    console.error('OpenAI chat failed:', error?.status || error?.cause?.code || 'network', message);
    return res.status(error?.status || 502).json({ error: message });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  try {
    for await (const chunk of stream) {
      if (closed) break;
      const token = chunk.choices?.[0]?.delta?.content || '';
      if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }
    if (!closed) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (error) {
    if (closed) return;
    const message = friendlyError(error);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'), (error) => error && next());
  });
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  const server = app.listen(PORT, '127.0.0.1', () => {
    const dev = process.env.NODE_ENV !== 'production';
    console.log(
      dev
        ? `Family Doctor API on http://127.0.0.1:${PORT} — open http://127.0.0.1:5173`
        : `Family Doctor on http://127.0.0.1:${PORT}`,
    );
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
      process.exit(1);
    }
    throw error;
  });
}

export default app;

function currentModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function chooseModel(value) {
  const model = String(value || currentModel());
  return MODELS.includes(model) ? model : currentModel();
}

function isPlausibleKey(key) {
  return key.length >= 20 && key.length <= 300 && /^[A-Za-z0-9_-]+$/.test(key);
}

function usesReasoning(model) {
  if (model.includes('-chat')) return false;
  return /^o\d/.test(model) || /^gpt-[5-9]/.test(model);
}

function instructionRole(model) {
  if (/^o\d/.test(model) || /^gpt-[5-9]/.test(model)) return 'developer';
  return 'system';
}

function buildPrompt(about) {
  const who = SUBJECTS[about.subject] || SUBJECTS.me;
  const detail = about.detail
    ? `The household added this context: ${about.detail}.`
    : 'Age and medical history were not provided. Ask when the answer depends on them.';

  return `You are Family Doctor, a chatbot for one household. You sound like a calm family physician talking at the kitchen table. You help people understand symptoms, home care, and when to contact a clinic.

This visit is about ${who}. ${detail}

Rules you must follow:
- You are not their clinician. You cannot examine, diagnose, prescribe, or give a personal medication dose.
- Do not invent measurements, test results, or a definite diagnosis.
- Ask a few short follow-up questions when the next step depends on missing facts.
- For medicines, explain general cautions only, and tell them to confirm with their pharmacist, prescriber, or the product label.
- If this could be an emergency, say that in the first sentence. Tell them to call emergency services (911 in the United States) or go to an emergency department. Treat these as emergencies: trouble breathing, chest pain or pressure, signs of stroke, a seizure, heavy bleeding, anaphylaxis, a child who is limp or hard to wake, a stiff neck with fever, blue or gray lips, suicidal thoughts, or an illness that is getting worse quickly.
- If someone may be in emotional crisis, encourage local emergency services or the 988 Suicide and Crisis Lifeline in the United States.
- Name the right level of care when you can: home watching, a regular clinic, same-day clinic, urgent care, or emergency department.
- Be warm, plain, and brief. Use short paragraphs. You may use dashes for a short list of warning signs. Do not use markdown headings.
- End with the single most useful next step.`;
}

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 6000).trim(),
    }))
    .filter((message) => message.content && !message.content.startsWith('Tell me what is going on, who it is happening to'))
    .slice(-24);
}

function sanitizeAbout(about) {
  const subject = Object.hasOwn(SUBJECTS, about?.subject) ? about.subject : 'me';
  const detail = typeof about?.detail === 'string'
    ? about.detail.replace(/\s+/g, ' ').trim().slice(0, 240)
    : '';
  return { subject, detail };
}

function writeEnvValues(values) {
  const envPath = path.join(root, '.env');
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    text = new RegExp(`^${name}=.*$`, 'm').test(text)
      ? text.replace(new RegExp(`^${name}=.*$`, 'm'), line)
      : `${text.trim()}${text.trim() ? '\n' : ''}${line}\n`;
  }
  if (!text.endsWith('\n')) text += '\n';
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

function friendlyError(error) {
  const status = error?.status;
  const secret = process.env.OPENAI_API_KEY;
  const raw = String(error?.message || '').replaceAll(secret || '___none___', '[key]');
  if (status === 401) return 'OpenAI rejected that API key. Check the key and try again.';
  if (/connection error/i.test(raw)) return 'The server could not connect to OpenAI. Check the network and try again.';
  if (status === 429) return 'OpenAI is limiting this key right now, or the account is out of quota.';
  if (status === 404) return 'That model is not available for this API key. Choose another model and save again.';
  if (raw && raw.length < 220 && !/sk-[A-Za-z0-9_-]{8,}/.test(raw)) return raw;
  return 'The Family Doctor chatbot could not reach OpenAI. Try again in a moment.';
}
