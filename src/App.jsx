import { useEffect, useRef, useState } from 'react';

const STORAGE = 'family-doctor.visit';
const ABOUT = 'family-doctor.about';

const SUBJECTS = [
  { id: 'me', label: 'Me', detail: 'Age or conditions that matter' },
  { id: 'child', label: 'A child', detail: 'Child’s age' },
  { id: 'partner', label: 'My partner', detail: 'Age or relevant conditions' },
  { id: 'parent', label: 'A parent', detail: 'Age or relevant conditions' },
  { id: 'other', label: 'Someone else', detail: 'Who they are, and their age' },
];

const PROMPTS = [
  {
    subject: 'child',
    label: 'Fever in a child',
    text: 'My child has had a fever since last night and is still drinking. What should I watch for overnight?',
  },
  {
    subject: 'me',
    label: 'Sore throat',
    text: 'I woke up with a sore throat and no cough. Can this wait for a regular clinic visit?',
  },
  {
    subject: 'parent',
    label: 'A parent’s checkup',
    text: 'My parent has a routine checkup next week. What is worth writing down beforehand?',
  },
  {
    subject: 'other',
    label: 'Stomach bug at home',
    text: 'Several of us have a stomach bug. How should we handle fluids, food, and keeping it from spreading?',
  },
  {
    subject: 'me',
    label: 'A way of eating',
    text: 'I have been skipping breakfast and eating most of my food late at night. Is that a healthy pattern?',
  },
];

const MODEL_LABELS = {
  'chat-latest': 'ChatGPT',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
};

const MODEL_NOTES = {
  'chat-latest': 'The current ChatGPT model. This is the default.',
  'gpt-5.6-sol': 'Newer OpenAI model for harder questions.',
  'gpt-5.6-luna': 'Lower cost model for shorter answers.',
};

function greeting() {
  return {
    id: 'greeting',
    role: 'assistant',
    local: true,
    content:
      "Hi, my name's Maddie. I can help with health questions — symptoms, injuries, mental health, sleep, and whether a meal or a way of eating is a healthy one. If a photo would help, attach it. I will look carefully, lay out the possibilities, and once you tell me which one fits, we can talk through what to do next. Tell me what is going on, who it is happening to, and when it started. I cannot examine anyone in person or make a diagnosis.",
  };
}

function readStoredMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) || '');
    if (!Array.isArray(parsed)) return [greeting()];
    const clean = parsed
      .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && typeof message.id === 'string')
      .slice(-40);
    if (clean.some((message) => message.role === 'user')) {
      if (clean[0]?.id === 'greeting' || clean[0]?.local) return [greeting(), ...clean.slice(1)];
      return [greeting(), ...clean];
    }
  } catch {
    /* start a fresh visit */
  }
  return [greeting()];
}

function readStoredAbout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ABOUT) || '');
    if (parsed && SUBJECTS.some((item) => item.id === parsed.subject)) {
      return {
        subject: parsed.subject,
        detail: String(parsed.detail || '').slice(0, 240),
      };
    }
  } catch {
    /* default subject */
  }
  return { subject: 'me', detail: '' };
}

function RichText({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function compressPhoto(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    return Promise.reject(new Error('Choose a JPEG, PNG, or WebP photo.'));
  }
  if (file.size > 12 * 1024 * 1024) {
    return Promise.reject(new Error('That photo is too large. Try one under 12 MB.'));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let dataUrl = shrinkPhoto(img, 1600, 0.82);
        if (!dataUrl || dataUrl.length > 1_200_000) dataUrl = shrinkPhoto(img, 1280, 0.72);
        if (!dataUrl || dataUrl.length > 1_200_000) dataUrl = shrinkPhoto(img, 960, 0.66);
        if (!dataUrl || dataUrl.length > 1_200_000) {
          reject(new Error('That photo is still too large. Try a smaller one.'));
          return;
        }
        resolve({ dataUrl, name: file.name || 'Photo' });
      } catch {
        reject(new Error('That photo could not be prepared. Try a different one.'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as a photo.'));
    };
    img.src = url;
  });
}

function shrinkPhoto(img, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M16 8.2 23 14v9.2H9V14l7-5.8Z" fill="none" stroke="#f3eee4" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M16 15.2v6.2M12.9 18.3h6.2" stroke="#f3eee4" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const storedAbout = readStoredAbout();
  const [messages, setMessages] = useState(readStoredMessages);
  const [subject, setSubject] = useState(storedAbout.subject);
  const [detail, setDetail] = useState(storedAbout.detail);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [booting, setBooting] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('chat-latest');
  const [models, setModels] = useState(['chat-latest', 'gpt-5.6-sol', 'gpt-5.6-luna']);
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, setPending] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const abortRef = useRef(null);
  const fileRef = useRef(null);
  const scrollerRef = useRef(null);
  const stickRef = useRef(true);
  const composerRef = useRef(null);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const subjectMeta = SUBJECTS.find((item) => item.id === subject) || SUBJECTS[0];

  useEffect(() => {
    let cancelled = false;
    fetch('/api/status')
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setConfigured(Boolean(data.configured));
        setShowKey(!data.configured);
        if (data.model) setModel(data.model);
        if (Array.isArray(data.models) && data.models.length) setModels(data.models);
      })
      .catch(() => {
        if (!cancelled) setError('The local Family Doctor server is not responding.');
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const stored = messages
        .filter((message) => message.content)
        .slice(-40)
        .map(({ image, ...message }) => (image ? { ...message, hadImage: true } : message));
      localStorage.setItem(STORAGE, JSON.stringify(stored));
    } catch {
      /* storage can be unavailable in private browsing */
    }
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(ABOUT, JSON.stringify({ subject, detail }));
    } catch {
      /* storage can be unavailable in private browsing */
    }
  }, [subject, detail]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, showKey]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  function resetVisit() {
    abortRef.current?.abort();
    setMessages([greeting()]);
    setInput('');
    setAttachment(null);
    setError('');
    setConfirmClear(false);
  }

  async function saveKey(event) {
    event.preventDefault();
    setSavingKey(true);
    setError('');
    try {
      const response = await fetch('/api/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, remember, model }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The API key could not be saved.');
      setConfigured(true);
      setShowKey(false);
      setApiKey('');
      if (data.model) setModel(data.model);
      if (data.warning) setError(data.warning);
      if (pending) {
        const next = pending;
        setPending(null);
        send(next.text, next.subjectId, { force: true, image: next.image || null });
      } else {
        composerRef.current?.focus();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(false);
    }
  }

  async function send(text, subjectId = subject, { force = false, image = null } = {}) {
    const trimmed = text.trim();
    const photo = image || null;
    if ((!trimmed && !photo) || streaming) return;
    const content = trimmed || 'Please look at this photo and help me understand what it could be.';
    if (!configured && !force) {
      setPending({ text: content, subjectId, image: photo });
      setSubject(subjectId);
      setShowKey(true);
      setError('');
      return;
    }

    setSubject(subjectId);
    setInput('');
    setAttachment(null);
    setError('');
    if (composerRef.current) composerRef.current.style.height = 'auto';
    setConfirmClear(false);
    stickRef.current = true;

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      ...(photo ? { image: photo } : {}),
    };
    const assistantId = crypto.randomUUID();
    const history = [...messages, userMessage];
    setMessages([...history, { id: assistantId, role: 'assistant', content: '' }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history
            .filter((message) => !message.local && message.content)
            .map(({ role, content, image: photoMessage }) => ({
              role,
              content,
              ...(photoMessage?.dataUrl ? { image: { dataUrl: photoMessage.dataUrl } } : {}),
            })),
          about: { subject: subjectId, detail: detail.trim() },
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'The visit could not start.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((item) => item.startsWith('data: '));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.error) throw new Error(payload.error);
          if (payload.token) {
            accumulated += payload.token;
            const snapshot = accumulated;
            setMessages((current) => current.map((message) => (
              message.id === assistantId ? { ...message, content: snapshot } : message
            )));
          }
        }
      }

      if (!accumulated) {
        setMessages((current) => current.map((message) => (
          message.id === assistantId
            ? { ...message, content: 'I did not get a reply. Try the question again.' }
            : message
        )));
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
      } else {
        setError(err.message || 'Something went wrong with this visit.');
        setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function onComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  }

  async function onPickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || streaming) return;
    setError('');
    try {
      setAttachment(await compressPhoto(file));
    } catch (err) {
      setAttachment(null);
      setError(err.message);
    }
  }

  function onComposerChange(event) {
    setInput(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
  }

  const modelChoices = [...new Set([model, ...models])];

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <p className="eyebrow">Household chatbot</p>
            <h1>Family Doctor</h1>
          </div>
        </div>
        <p className="status">
          <span className={configured ? 'dot on' : 'dot'} />
          {configured ? `OpenAI connected · ${MODEL_LABELS[model] || model}` : 'OpenAI API key needed'}
        </p>
      </header>

      <main className="layout">
        <aside className="side">
          <section className="panel">
            <p className="visit-date">{today}</p>
            <h2>Who is this visit about?</h2>
            <div className="chips" role="radiogroup" aria-label="Who is this visit about?">
              {SUBJECTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={subject === item.id}
                  className={subject === item.id ? 'chip on' : 'chip'}
                  onClick={() => setSubject(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="field">
              Context for this person
              <input
                value={detail}
                maxLength={240}
                placeholder={subjectMeta.detail}
                onChange={(event) => setDetail(event.target.value)}
              />
            </label>
          </section>

          <section className="panel">
            <h2>Start with a question</h2>
            <p className="quiet scope-note">Health, mental health, and food. Maddie will leave other topics alone.</p>
            <div className="prompts">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  type="button"
                  onClick={() => send(prompt.text, prompt.subject)}
                  disabled={streaming || booting}
                >
                  <span>{prompt.label}</span>
                  <small>{prompt.text}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="panel urgent">
            <h2>Emergency</h2>
            <p>
              Call emergency services now for trouble breathing, chest pain, stroke signs, a seizure, heavy bleeding, a limp or unresponsive child, or thoughts of suicide.
            </p>
            <p>In the United States, call 911. For a mental health crisis, call or text 988.</p>
          </section>

          <div className="side-actions">
            {confirmClear ? (
              <div className="confirm">
                <p>Clear this visit from the browser?</p>
                <button type="button" onClick={resetVisit}>Clear</button>
                <button type="button" className="text" onClick={() => setConfirmClear(false)}>Keep</button>
              </div>
            ) : (
              <button type="button" className="text" onClick={() => setConfirmClear(true)} disabled={streaming}>
                New visit
              </button>
            )}
            <button type="button" className="text" onClick={() => { setShowKey(true); setError(''); }}>
              {configured ? 'Change API key' : 'Add API key'}
            </button>
          </div>
        </aside>

        <section className="chat" aria-busy={streaming}>
          {booting ? (
            <p className="booting">Opening the room…</p>
          ) : showKey ? (
            <form className="key-card" onSubmit={saveKey}>
              <p className="eyebrow dark">OpenAI</p>
              <h2>Add your API key</h2>
              <p>
                Family Doctor sends each question to OpenAI and bills it to your key. The key stays on this computer. If you remember it, it is written to a local <code>.env</code> file and is not shown again.
              </p>
              <p className="quiet">
                Do not type information, or attach a photo, you would not want sent to OpenAI. This chatbot is not a medical record and not a clinical service.
              </p>
              {pending && <p className="quiet">Your question will send as soon as the key is saved.</p>}
              <label className="field">
                API key
                <input
                  type="password"
                  value={apiKey}
                  autoComplete="off"
                  spellCheck="false"
                  placeholder={configured ? 'Paste a new key, or leave blank to keep the current one' : 'sk-…'}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoFocus
                />
              </label>
              <label className="field">
                Model
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  {modelChoices.map((item) => (
                    <option key={item} value={item}>{MODEL_LABELS[item] || item}</option>
                  ))}
                </select>
              </label>
              <p className="quiet">{MODEL_NOTES[model] || 'Using the model selected for this computer.'}</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Remember the key and model on this computer
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="key-actions">
                <button type="submit" className="primary" disabled={savingKey}>
                  {savingKey ? 'Checking with OpenAI…' : 'Save and open the chat'}
                </button>
                {configured && (
                  <button type="button" className="text" onClick={() => { setShowKey(false); setError(''); }}>
                    Back to the visit
                  </button>
                )}
              </div>
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                Get an API key from OpenAI
              </a>
            </form>
          ) : (
            <>
              <header className="chat-head">
                <p className="eyebrow dark">Family Doctor</p>
                <h2>Maddie</h2>
              </header>
              <div className="log" ref={scrollerRef} onScroll={onScroll} role="log" aria-label="Visit with Maddie">
                {messages.map((message) => (
                  <article key={message.id} className={message.role === 'user' ? 'turn mine' : 'turn'}>
                    <p className="who">{message.role === 'user' ? 'You' : 'Maddie'}</p>
                    <div className="bubble">
                      {message.image?.dataUrl ? (
                        <img className="shot" src={message.image.dataUrl} alt="Photo you attached" />
                      ) : message.hadImage ? (
                        <p className="photo-note">A photo was attached. It is no longer saved on this device.</p>
                      ) : null}
                      {message.role === 'assistant' && !message.content ? (
                        <p className="waiting" aria-label="Maddie is thinking">
                          <span /><span /><span />
                        </p>
                      ) : (
                        <p><RichText text={message.content} /></p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  send(input, subject, { image: attachment });
                }}
              >
                {error && <p className="error" role="alert">{error}</p>}
                {attachment && (
                  <div className="staged">
                    <img src={attachment.dataUrl} alt="" />
                    <div>
                      <p>Photo ready for Maddie to look at</p>
                      <button type="button" className="text" onClick={() => setAttachment(null)}>
                        Remove photo
                      </button>
                    </div>
                  </div>
                )}
                <div className="composer-row">
                  <input
                    ref={fileRef}
                    className="sr"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={onPickPhoto}
                  />
                  <button
                    type="button"
                    className="attach"
                    aria-label="Attach a photo"
                    disabled={streaming}
                    onClick={() => fileRef.current?.click()}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M8.2 7.4 12 3.6l3.8 3.8M12 4.2v10.2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M5 14.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  <label className="sr" htmlFor="question">Your question</label>
                  <textarea
                    id="question"
                    ref={composerRef}
                    rows={1}
                    value={input}
                    placeholder="What's going on?"
                    onChange={onComposerChange}
                    onKeyDown={onComposerKeyDown}
                  />
                  {streaming ? (
                    <button type="button" className="primary" onClick={() => abortRef.current?.abort()}>
                      Stop
                    </button>
                  ) : (
                    <button type="submit" className="primary" disabled={!input.trim() && !attachment}>
                      Send
                    </button>
                  )}
                </div>
                <p className="disclaimer">
                  Informational only. Maddie cannot diagnose, prescribe, or replace a clinician. A photo can suggest possibilities, not a definite answer. Questions and photos are sent to OpenAI with your API key.
                </p>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
