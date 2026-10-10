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
      'Tell me what is going on, who it is happening to, and when it started. I can help you sort home care from a call to the clinic. I cannot examine anyone or make a diagnosis.',
  };
}

function readStoredMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) || '');
    if (!Array.isArray(parsed)) return [greeting()];
    const clean = parsed
      .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && typeof message.id === 'string')
      .slice(-40);
    if (clean.some((message) => message.role === 'user')) return clean;
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
  const abortRef = useRef(null);
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
      const stored = messages.filter((message) => message.content).slice(-40);
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
        send(next.text, next.subjectId, { force: true });
      } else {
        composerRef.current?.focus();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(false);
    }
  }

  async function send(text, subjectId = subject, { force = false } = {}) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    if (!configured && !force) {
      setPending({ text: trimmed, subjectId });
      setSubject(subjectId);
      setShowKey(true);
      setError('');
      return;
    }

    setSubject(subjectId);
    setInput('');
    setError('');
    if (composerRef.current) composerRef.current.style.height = 'auto';
    setConfirmClear(false);
    stickRef.current = true;

    const userMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed };
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
            .map(({ role, content }) => ({ role, content })),
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
                Do not type information you would not want sent to OpenAI. This chatbot is not a medical record and not a clinical service.
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
              <div className="log" ref={scrollerRef} onScroll={onScroll} role="log" aria-label="Visit conversation">
                {messages.map((message) => (
                  <article key={message.id} className={message.role === 'user' ? 'turn mine' : 'turn'}>
                    <p className="who">{message.role === 'user' ? 'You' : 'Family Doctor'}</p>
                    <div className="bubble">
                      {message.role === 'assistant' && !message.content ? (
                        <p className="waiting" aria-label="Family Doctor is thinking">
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
                  send(input);
                }}
              >
                {error && <p className="error" role="alert">{error}</p>}
                <div className="composer-row">
                  <label className="sr" htmlFor="question">Your question</label>
                  <textarea
                    id="question"
                    ref={composerRef}
                    rows={1}
                    value={input}
                    placeholder="Describe what started, and when"
                    onChange={onComposerChange}
                    onKeyDown={onComposerKeyDown}
                  />
                  {streaming ? (
                    <button type="button" className="primary" onClick={() => abortRef.current?.abort()}>
                      Stop
                    </button>
                  ) : (
                    <button type="submit" className="primary" disabled={!input.trim()}>
                      Send
                    </button>
                  )}
                </div>
                <p className="disclaimer">
                  Informational only. This chatbot cannot diagnose, prescribe, or replace a clinician. Questions are sent to OpenAI with your API key.
                </p>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
