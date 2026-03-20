import React from 'react';

async function apiGet(path) {
  const resp = await fetch(path);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
  return data;
}

async function apiPost(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}'
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
  return data;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString();
}

function splitTextIntoLinks(text) {
  const s = String(text || '');
  if (!s) return [s];

  // Match URLs in plain text, including Discord's <https://...> formatting.
  const re =
    /<\s*(https?:\/\/[^\s>|]+)(?:\|[^>]+)?\s*>|\b(https?:\/\/[^\s<]+|www\.[^\s<]+|(?:discord\.gg|t\.co|x\.com|twitter\.com|youtu\.be|youtube\.com|github\.com|reddit\.com|t\.me)\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+)/gi;

  /** @type {Array<{type: 'text', value: string} | {type: 'link', text: string, href: string}>} */
  const parts = [];

  let lastIndex = 0;
  let match;
  while ((match = re.exec(s))) {
    const start = match.index;
    const raw = match[1] || match[2] || '';
    if (start > lastIndex) {
      parts.push({ type: 'text', value: s.slice(lastIndex, start) });
    }

    let urlText = raw;

    // Trim common trailing punctuation while keeping URL intact.
    // e.g. "https://x.com)." -> "https://x.com"
    urlText = urlText.replace(/[\s\"'”’]+$/g, '');
    urlText = urlText.replace(/[\]\)}>,.;:!?]+$/g, '');

    const href = urlText.startsWith('www.') ? `https://${urlText}` : urlText.includes('://') ? urlText : `https://${urlText}`;
    if (href) {
      parts.push({ type: 'link', text: urlText, href });
    }

    lastIndex = re.lastIndex;
  }

  if (lastIndex < s.length) {
    parts.push({ type: 'text', value: s.slice(lastIndex) });
  }

  // If nothing matched, return original string.
  if (!parts.length) return [s];
  return parts;
}

export default function DiscordTab() {
  const [status, setStatus] = React.useState({ running: false, loggedIn: false, needsLogin: false, headless: false });
  const [error, setError] = React.useState('');

  const [showBrowser, setShowBrowser] = React.useState(true);
  const [starting, setStarting] = React.useState(false);
  const [fetchingToday, setFetchingToday] = React.useState(false);

  const [guilds, setGuilds] = React.useState([]);
  const [channels, setChannels] = React.useState([]);
  const [guildId, setGuildId] = React.useState('');
  const [channelId, setChannelId] = React.useState('');

  const [messages, setMessages] = React.useState([]);
  const [filterText, setFilterText] = React.useState('');
  const [refineText, setRefineText] = React.useState('');
  const [autoScrollLatest, setAutoScrollLatest] = React.useState(true);
  const [messageSeq, setMessageSeq] = React.useState(0);

  const [soundEnabled, setSoundEnabled] = React.useState(true);
  const [notifyEnabled, setNotifyEnabled] = React.useState(true);
  const eventSourceRef = React.useRef(null);

  const feedListRef = React.useRef(null);

  const filterTextRef = React.useRef('');
  const refineTextRef = React.useRef('');
  const soundEnabledRef = React.useRef(true);
  const notifyEnabledRef = React.useRef(true);
  const notifiedIdsRef = React.useRef(new Set());
  const audioCtxRef = React.useRef(null);

  function fireAndForgetPushover({ title, message }) {
    try {
      fetch('/api/pushover/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message })
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  const loadedGuildsRef = React.useRef(false);
  const loadedChannelsForGuildRef = React.useRef('');
  const syncedSelectionRef = React.useRef(false);

  async function loadGuilds() {
    const g = await apiGet('/api/discord/guilds');
    setGuilds(Array.isArray(g.guilds) ? g.guilds : []);
  }

  async function loadChannelsForGuild(nextGuildId) {
    if (!nextGuildId) return;
    const data = await apiGet(`/api/discord/channels?guildId=${encodeURIComponent(nextGuildId)}`);
    setChannels(Array.isArray(data.channels) ? data.channels : []);
  }

  async function refreshStatus() {
    const s = await apiGet('/api/discord/status');
    setStatus(s);
    return s;
  }

  React.useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        setError('');
        const s = await apiGet('/api/discord/status');
        if (!cancelled) setStatus(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load Discord status');
      }
    }

    tick();
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  React.useEffect(() => {
    // Stop SSE on unmount.
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (!autoScrollLatest) return;
    // Newest messages render at the top; keep scroll anchored there.
    // Use rAF so the DOM has updated before we adjust scroll.
    requestAnimationFrame(() => {
      const el = feedListRef.current;
      if (!el) return;
      el.scrollTop = 0;
    });
  }, [messageSeq, autoScrollLatest]);

  React.useEffect(() => {
    filterTextRef.current = filterText;
  }, [filterText]);

  React.useEffect(() => {
    refineTextRef.current = refineText;
  }, [refineText]);

  React.useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  React.useEffect(() => {
    notifyEnabledRef.current = notifyEnabled;
  }, [notifyEnabled]);

  function getNotificationPermission() {
    if (typeof window === 'undefined') return 'unsupported';
    if (typeof window.Notification === 'undefined') return 'unsupported';
    return window.Notification.permission;
  }

  async function requestNotificationPermission() {
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
      setError('Notifications are not supported in this browser');
      return;
    }

    try {
      const result = await window.Notification.requestPermission();
      if (result !== 'granted') {
        setError('Notification permission not granted');
      } else {
        setError('');
        setNotifyEnabled(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request notification permission');
    }
  }

  async function ensureAudioContext() {
    if (typeof window === 'undefined') return null;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContextCtor();
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }

  async function playBeep() {
    const ctx = await ensureAudioContext();
    if (!ctx) return;

    // Simple, short beep.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 880;

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  }

  function matchesStackedFilters(message, f1, f2) {
    const q1 = String(f1 || '').trim().toLowerCase();
    const q2 = String(f2 || '').trim().toLowerCase();
    const author = String(message?.author || '').toLowerCase();
    const content = String(message?.content || '').toLowerCase();

    const matches = (q) => {
      if (!q) return true;
      return author.includes(q) || content.includes(q);
    };

    return matches(q1) && matches(q2);
  }

  React.useEffect(() => {
    // If a Discord session is already running (e.g. page refresh), auto-load guilds so the dropdown isn't empty.
    // Also sync local selection from backend status once.
    if (!status.running) {
      loadedGuildsRef.current = false;
      loadedChannelsForGuildRef.current = '';
      syncedSelectionRef.current = false;
      return;
    }

    if (!status.loggedIn) return;

    if (!loadedGuildsRef.current) {
      loadedGuildsRef.current = true;
      loadGuilds().catch(() => {
        // best-effort; user can still stop/start
      });
    }

    const selectedGuildId = status?.selected?.guildId || '';
    const selectedChannelId = status?.selected?.channelId || '';

    if (!syncedSelectionRef.current && selectedGuildId) {
      syncedSelectionRef.current = true;

      if (!guildId) {
        setGuildId(selectedGuildId);
      }

      if (loadedChannelsForGuildRef.current !== selectedGuildId) {
        loadedChannelsForGuildRef.current = selectedGuildId;
        setChannels([]);
        loadChannelsForGuild(selectedGuildId)
          .then(() => {
            if (selectedChannelId && !channelId) setChannelId(selectedChannelId);
          })
          .catch(() => {
            // best-effort
          });
      }
    }
  }, [status.running, status.loggedIn, status?.selected?.guildId, status?.selected?.channelId, guildId, channelId]);

  async function onStart() {
    setStarting(true);
    try {
      setError('');
      const s = await apiPost('/api/discord/start', { showBrowser });
      setStatus(s);

      // If already logged in, load guild list.
      if (s.loggedIn) {
        await loadGuilds();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start Discord session');
    } finally {
      setStarting(false);
    }
  }

  async function onStop() {
    try {
      setError('');
      const s = await apiPost('/api/discord/stop');
      setStatus(s);
      setGuilds([]);
      setChannels([]);
      setGuildId('');
      setChannelId('');
      setMessages([]);

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop Discord session');
    }
  }

  async function onResetAuth() {
    try {
      setError('');
      await apiPost('/api/discord/reset-auth');
      await refreshStatus();
      setGuilds([]);
      setChannels([]);
      setGuildId('');
      setChannelId('');
      setMessages([]);

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset auth');
    }
  }

  async function onWaitLogin() {
    try {
      setError('');
      const s = await apiPost('/api/discord/wait-login', { timeoutMs: 10 * 60 * 1000 });
      setStatus(s);
      await loadGuilds();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Timed out waiting for login');
    }
  }

  async function onSelectGuild(nextGuildId) {
    setGuildId(nextGuildId);
    setChannelId('');
    setChannels([]);

    if (!nextGuildId) return;

    try {
      setError('');
      loadedChannelsForGuildRef.current = nextGuildId;
      await loadChannelsForGuild(nextGuildId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load channels');
    }
  }

  function connectStream() {
    if (eventSourceRef.current) return;

    const es = new EventSource('/api/discord/stream');
    eventSourceRef.current = es;

    es.addEventListener('status', (ev) => {
      try {
        const s = JSON.parse(ev.data);
        setStatus(s);
      } catch {
        // ignore
      }
    });

    es.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);

        // Alert only for messages that pass the current stacked filters.
        const shouldAlert = matchesStackedFilters(msg, filterTextRef.current, refineTextRef.current);
        const messageId = String(msg?.messageId || '');
        const alreadyNotified = messageId && notifiedIdsRef.current.has(messageId);

        if (shouldAlert && messageId && !alreadyNotified) {
          notifiedIdsRef.current.add(messageId);
          if (notifiedIdsRef.current.size > 2000) notifiedIdsRef.current.clear();

          if (soundEnabledRef.current) {
            playBeep().catch(() => {});
          }

          if (notifyEnabledRef.current) {
            const perm = getNotificationPermission();
            if (perm === 'granted') {
              const title = msg?.author ? `Discord: ${msg.author}` : 'Discord: New message';
              const body = String(msg?.content || '').slice(0, 220);
              try {
                new window.Notification(title, { body });
                fireAndForgetPushover({ title, message: body });
              } catch {
                // ignore
              }
            }
          }
        }

        setMessageSeq((n) => n + 1);
        setMessages((prev) => {
          // Keep newest-first.
          const next = [msg, ...prev];
          return next.length > 4000 ? next.slice(0, 4000) : next;
        });
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      // Browser will auto-reconnect; keep it quiet.
    };
  }

  async function onWatch() {
    if (!guildId || !channelId) return;
    try {
      setError('');
      setMessages([]);
      await apiPost('/api/discord/clear');
      const s = await apiPost('/api/discord/select', { guildId, channelId });
      setStatus(s);
      connectStream();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start watching channel');
    }
  }

  async function onFetchToday() {
    if (!status.running || !status.loggedIn || !guildId || !channelId) return;

    setFetchingToday(true);
    try {
      setError('');

      // Ensure the backend is on the currently selected channel.
      const selectedGuildId = status?.selected?.guildId || '';
      const selectedChannelId = status?.selected?.channelId || '';
      if (selectedGuildId !== guildId || selectedChannelId !== channelId) {
        const s = await apiPost('/api/discord/select', { guildId, channelId });
        setStatus(s);
        connectStream();
      }

      const result = await apiPost('/api/discord/fetch-today', {});
      const todays = Array.isArray(result?.messages) ? result.messages : [];

      // Replace feed with today's messages (newest first).
      setMessageSeq((n) => n + 1);
      setMessages(() => {
        const byId = new Map();
        for (const m of todays) {
          if (!m || !m.messageId) continue;
          byId.set(String(m.messageId), m);
        }

        const next = Array.from(byId.values());
        next.sort((a, b) => {
          const ta = Date.parse(a.timestamp || '') || 0;
          const tb = Date.parse(b.timestamp || '') || 0;
          return tb - ta;
        });
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch today's posts");
    } finally {
      setFetchingToday(false);
    }
  }

  async function onClearFeed() {
    setMessages([]);
    try {
      await apiPost('/api/discord/clear');
    } catch {
      // ignore
    }
  }

  const filterOnce = React.useCallback((list, query) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const author = String(m?.author || '').toLowerCase();
      const content = String(m?.content || '').toLowerCase();
      return author.includes(q) || content.includes(q);
    });
  }, []);

  const firstFilteredMessages = React.useMemo(() => {
    return filterOnce(messages, filterText);
  }, [messages, filterText, filterOnce]);

  const filteredMessages = React.useMemo(() => {
    return filterOnce(firstFilteredMessages, refineText);
  }, [firstFilteredMessages, refineText, filterOnce]);

  const disabledStart = starting || status.running;

  return (
    <div className="discordTab">
      <div className="box full">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="label">Discord</div>
            <div className="muted small" style={{ marginBottom: 0 }}>
              Playwright-controlled Discord web session. First run may require manual login + MFA.
            </div>
          </div>
          <div className="row">
            <label className="muted small" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={showBrowser}
                onChange={(e) => setShowBrowser(e.target.checked)}
                style={{ marginRight: 8 }}
                disabled={status.running}
              />
              Show browser window
            </label>
            <button className="button" type="button" onClick={onStart} disabled={disabledStart}>
              {starting ? 'Starting…' : status.running ? 'Running' : 'Start'}
            </button>
            <button className="button secondary" type="button" onClick={onStop} disabled={!status.running}>
              Stop
            </button>
            <button className="button secondary" type="button" onClick={onResetAuth}>
              Re-authenticate
            </button>
          </div>
        </div>

        <div className="discordStatusRow">
          <span className={`discordDot ${status.running ? 'on' : 'off'}`} />
          <span className="muted small" style={{ margin: 0 }}>
            {status.running
              ? status.loggedIn
                ? 'Session running • Logged in'
                : status.needsLogin
                  ? 'Session running • Please login in the Playwright window'
                  : 'Session running'
              : 'Session stopped'}
          </span>
          {status.running && status.needsLogin ? (
            <button className="button secondary" type="button" onClick={onWaitLogin}>
              I logged in
            </button>
          ) : null}
        </div>

        {error ? <div className="errorText">{error}</div> : null}

        {status.running && status.loggedIn ? (
          <div className="row" style={{ marginTop: 12 }}>
            <select className="select" value={guildId} onChange={(e) => onSelectGuild(e.target.value)} aria-label="Server">
              <option value="">Server…</option>
              {guilds.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <select
              className="select"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              aria-label="Channel"
              disabled={!guildId}
            >
              <option value="">Text channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>

            <button className="button" type="button" onClick={onWatch} disabled={!guildId || !channelId}>
              Watch
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={onFetchToday}
              disabled={!status.running || !status.loggedIn || !guildId || !channelId || fetchingToday}
              title="Load all posts from today for the selected channel"
            >
              {fetchingToday ? 'Fetching…' : "Fetch today's posts"}
            </button>
            <button className="button secondary" type="button" onClick={onClearFeed}>
              Clear feed
            </button>
          </div>
        ) : null}
      </div>

      <div className="box full discordFeed">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="label">Live feed</div>
            <div className="muted small" style={{ marginBottom: 0 }}>
              Live feed (plus optional fetch for today). Showing up to 4000 messages.
            </div>
          </div>
          <div className="muted small" style={{ margin: 0, textAlign: 'right' }}>
            <div>{guildId && channelId ? `Watching: ${guildId}/${channelId}` : 'Not watching'}</div>
            <div>
              {filterText.trim() || refineText.trim()
                ? refineText.trim()
                  ? `Filter: ${filteredMessages.length}/${firstFilteredMessages.length}/${messages.length}`
                  : `Filter: ${firstFilteredMessages.length}/${messages.length}`
                : `Messages: ${messages.length}`}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <input
            className="input"
            type="text"
            value={filterText}
            placeholder="Filter messages (author or text)…"
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilterText('');
            }}
          />
          <input
            className="input"
            type="text"
            value={refineText}
            placeholder="Refine filtered results…"
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setRefineText('');
            }}
          />
          <button
            className="button secondary"
            type="button"
            onClick={() => setFilterText('')}
            disabled={!filterText.trim()}
          >
            Clear filter
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => setRefineText('')}
            disabled={!refineText.trim()}
          >
            Clear refine
          </button>
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <label className="muted small" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={async (e) => {
                const next = e.target.checked;
                setSoundEnabled(next);
                if (next) {
                  // Make sure audio is allowed (requires user gesture).
                  await ensureAudioContext();
                }
              }}
              style={{ marginRight: 8 }}
            />
            Sound on match
          </label>

          <label className="muted small" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={autoScrollLatest}
              onChange={(e) => setAutoScrollLatest(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Always show latest
          </label>

          <label className="muted small" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={notifyEnabled}
              onChange={(e) => setNotifyEnabled(e.target.checked)}
              style={{ marginRight: 8 }}
              disabled={getNotificationPermission() === 'denied' || getNotificationPermission() === 'unsupported'}
            />
            Desktop notification on match
          </label>

          {getNotificationPermission() === 'default' ? (
            <button className="button secondary" type="button" onClick={requestNotificationPermission}>
              Enable notifications
            </button>
          ) : null}

          {getNotificationPermission() === 'denied' ? (
            <div className="muted small" style={{ margin: 0 }}>
              Notifications blocked in browser settings
            </div>
          ) : null}
        </div>

        {filteredMessages.length ? (
          <div className="discordFeedList" ref={feedListRef}>
            {filteredMessages.map((m) => (
              <div key={m.messageId} className="discordFeedItem">
                <div className="discordFeedMeta">
                  <span className="discordTime">{formatTime(m.timestamp)}</span>
                  <span className="discordAuthor">{m.author || 'Unknown'}</span>
                </div>
                <div className="discordContent">
                  {splitTextIntoLinks(m.content).map((p, idx) => {
                    if (typeof p === 'string') return <React.Fragment key={idx}>{p}</React.Fragment>;
                    if (p.type === 'text') return <React.Fragment key={idx}>{p.value}</React.Fragment>;
                    return (
                      <a key={idx} href={p.href} target="_blank" rel="noreferrer noopener">
                        {p.text}
                      </a>
                    );
                  })}

                  {Array.isArray(m.links) && m.links.length ? (
                    <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                      {m.links
                        .filter((l) => l && l.href)
                        .filter((l) => !String(m.content || '').includes(String(l.href)))
                        .slice(0, 10)
                        .map((l, j) => (
                          <a key={j} href={l.href} target="_blank" rel="noreferrer noopener">
                            {l.text ? `${l.text} — ${l.href}` : l.href}
                          </a>
                        ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted" style={{ marginBottom: 0 }}>
            {refineText.trim()
              ? 'No messages match your refine filter.'
              : filterText.trim()
                ? 'No messages match your filter.'
                : status.running && status.loggedIn && guildId && channelId
                  ? 'Waiting for new messages…'
                  : 'Start a session, pick a server + channel, then click Watch.'}
          </div>
        )}
      </div>

      <div className="muted small" style={{ marginTop: 10 }}>
        Note: Discord does not allow embedding its web app in an iframe, so the browser window opens separately.
      </div>
    </div>
  );
}
