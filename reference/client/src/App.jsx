export { default } from './AppShellApp.jsx';

/*
import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Drawer,
  Group,
  Modal,
  NumberInput,
              <Select
                w={120}
                data={[
                  { value: 'xai', label: 'xAI' },
                  { value: 'gemini', label: 'Gemini' }
                ]}
                value={providerByTab[tab]}
                onChange={(value) => {
                  if (!value) return;
                  setProviderByTab((prev) => ({ ...prev, [tab]: value }));
                }}
                aria-label="Provider"
                title="Choose which API to query"
              />
              <Select
                w={240}
                value={modelByTab?.[tab]?.[providerByTab[tab]] || null}
                placeholder={modelsError ? '(models failed to load)' : '(loading models…)'}
                disabled={(() => {
                  const provider = providerByTab[tab];
                  const selected = modelByTab?.[tab]?.[provider] || '';
                  const list = modelsByProvider[provider] || [];
                  return !selected && !list.length;
                })()}
                data={(() => {
                  const provider = providerByTab[tab];
                  const selected = modelByTab?.[tab]?.[provider] || '';
                  const list = modelsByProvider[provider] || [];
                  const options = selected && !list.includes(selected) ? [selected, ...list] : list;
                  return options.map((m) => ({ value: m, label: m }));
                })()}
                onChange={(value) => {
                  const provider = providerByTab[tab];
                  const next = value || '';
                  setModelByTab((prev) => ({
                    ...prev,
                    [tab]: {
                      ...prev[tab],
                      [provider]: next
                    }
                  }));
                }}
                aria-label="Model"
                title="Choose model"
              />
              <TextInput
                w={200}
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                placeholder="Ticker (e.g., AAPL)"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />

              <Select
                w={160}
                value={String(dilutionHorizonDays)}
                onChange={(value) => setDilutionHorizonDays(Number(value || dilutionHorizonDays))}
                data={[
                  { value: '30', label: '30d horizon' },
                  { value: '60', label: '60d horizon' },
                  { value: '90', label: '90d horizon' },
                  { value: '180', label: '180d horizon' }
                ]}
                aria-label="Horizon"
                title="How far back to scan filings"
              />

              <Select
                w={180}
                value={historyPickerValue}
                onChange={(value) => {
                  if (!value) return;
                  setHistoryPickerValue(value);
                  onPickHistoryTicker(value).finally(() => setHistoryPickerValue(null));
                }}
                data={(historyByTab[tab] || []).map((it) => ({ value: it.ticker, label: it.ticker }))}
                placeholder="History…"
                aria-label="History"
                title="Load a saved result from today"
              />

              <Button type="submit" loading={loadingByTab[tab]}>
                {loadingByTab[tab] ? 'Analyzing…' : 'Analyze'}
              </Button>
              <Button
                variant="default"
                type="button"
                onClick={() => {
                  setDilutionResult(null);
                  setHasDilutionResult(false);
                  setDilutionTicker('');
                  setErrorsByTab((prev) => ({ ...prev, dilution: '' }));
                }}
                disabled={loadingByTab[tab]}
              >
                Clear
              </Button>
    return Array.isArray(list) ? list : [];
  }
  return Array.isArray(data?.models) ? data.models : [];
            <Select
              w={120}
              data={[
                { value: 'xai', label: 'xAI' },
                { value: 'gemini', label: 'Gemini' }
              ]}
              value={providerByTab[tab]}
              onChange={(value) => {
                if (!value) return;
                setProviderByTab((prev) => ({ ...prev, [tab]: value }));
              }}
              aria-label="Provider"
              title="Choose which API to query"
            />
            <Select
              w={240}
              value={modelByTab?.[tab]?.[providerByTab[tab]] || null}
              placeholder={modelsError ? '(models failed to load)' : '(loading models…)'}
              disabled={(() => {
                const provider = providerByTab[tab];
                const selected = modelByTab?.[tab]?.[provider] || '';
                const list = modelsByProvider[provider] || [];
                return !selected && !list.length;
              })()}
              data={(() => {
                const provider = providerByTab[tab];
                const selected = modelByTab?.[tab]?.[provider] || '';
                const list = modelsByProvider[provider] || [];
                const options = selected && !list.includes(selected) ? [selected, ...list] : list;
                return options.map((m) => ({ value: m, label: m }));
              })()}
              onChange={(value) => {
                const provider = providerByTab[tab];
                const next = value || '';
                setModelByTab((prev) => ({
                  ...prev,
                  [tab]: {
                    ...prev[tab],
                    [provider]: next
                  }
                }));
              }}
              aria-label="Model"
              title="Choose model"
            />
            <TextInput
              w={200}
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder="Ticker (e.g., AAPL)"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <Select
              w={180}
              value={historyPickerValue}
              onChange={(value) => {
                if (!value) return;
                setHistoryPickerValue(value);
                onPickHistoryTicker(value).finally(() => setHistoryPickerValue(null));
              }}
              data={(historyByTab[tab] || []).map((it) => ({ value: it.ticker, label: it.ticker }))}
              placeholder="History…"
              aria-label="History"
              title="Load a saved result from today"
            />
            <Button type="submit" loading={loadingByTab[tab]}>
              {loadingByTab[tab]
                ? 'Asking…'
                : tab === 'runway'
                  ? 'Get runway'
                  : tab === 'news'
                    ? 'Get news'
                    : 'Get analyst sentiment'}
            </Button>
function formatConsensusTargets(consensus) {
  if (!consensus || typeof consensus !== 'object') return '—';
  const parts = [];
  if (typeof consensus.lowUsd === 'number') parts.push(`Low ${formatUsdPrice(consensus.lowUsd)}`);
  if (typeof consensus.meanUsd === 'number') parts.push(`Mean ${formatUsdPrice(consensus.meanUsd)}`);
  if (typeof consensus.medianUsd === 'number') parts.push(`Median ${formatUsdPrice(consensus.medianUsd)}`);
  if (typeof consensus.highUsd === 'number') parts.push(`High ${formatUsdPrice(consensus.highUsd)}`);
  const base = parts.length ? parts.join(' • ') : '—';
  if (typeof consensus.analystCount === 'number') return `${base} (n=${consensus.analystCount})`;
  return base;
}

function formatMonths(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `${n} months`;
}

function formatPct(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `${n}%`;
}

function formatDateTime(iso) {
  if (typeof iso !== 'string' || !iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function sortByPublishedAtDesc(items) {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => {
    const ta = a?.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b?.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });
}

function BucketGrid({ buckets, mode }) {
  if (!buckets) return <div className="muted">—</div>;
  const keys = ['1h', '24h', 'week', 'month'];
  return (
    <div className="bucketGrid">
      {keys.map((k) => {
        const b = buckets[k];
        if (!b) return null;
        return (
          <div key={k} className="bucketCard">
            <div className="label">{k}</div>
            {mode === 'pct' ? (
              <>
                <div className="value">{formatPct(b.positivePct)}</div>
                <div className="muted small">
                  {b.positive} pos / {b.negative} neg / {b.neutral} neu ({b.total})
                </div>
              </>
            ) : (
              <>
                <div className="value">{b.positive} / {b.negative}</div>
                <div className="muted small">pos / neg (neu {b.neutral}, total {b.total})</div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

*/

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = React.useMemo(() => tabFromPathname(location.pathname), [location.pathname]);
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const [tickerInput, setTickerInput] = React.useState('');
  const [historyPickerValue, setHistoryPickerValue] = React.useState(null);
  const [adhocHistoryPickerId, setAdhocHistoryPickerId] = React.useState(null);

  React.useEffect(() => {
    const desired = pathFromTab(tabFromPathname(location.pathname));
    if (location.pathname !== desired) {
      navigate(desired, { replace: true });
    }
  }, [location.pathname, navigate]);

  const [providerByTab, setProviderByTab] = React.useState({
    runway: 'xai',
    news: 'xai',
    analysts: 'xai',
    adhoc: 'xai',
    dilution: 'xai'
  });
  const [modelByTab, setModelByTab] = React.useState({
    runway: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    news: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    analysts: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    adhoc: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    dilution: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' }
  });
  const [modelsByProvider, setModelsByProvider] = React.useState({ xai: [], gemini: [] });
  const [modelsError, setModelsError] = React.useState('');
  const [historyByTab, setHistoryByTab] = React.useState({ runway: [], news: [], analysts: [], adhoc: [], dilution: [] });
  const [historyErrorByTab, setHistoryErrorByTab] = React.useState({ runway: '', news: '', analysts: '', adhoc: '', dilution: '' });

  const [runway, setRunway] = React.useState(null);
  const [hasRunwayResult, setHasRunwayResult] = React.useState(false);
  const [runwayTicker, setRunwayTicker] = React.useState('');

  const [news, setNews] = React.useState(null);
  const [hasNewsResult, setHasNewsResult] = React.useState(false);
  const [newsTicker, setNewsTicker] = React.useState('');

  const [analysts, setAnalysts] = React.useState(null);
  const [hasAnalystsResult, setHasAnalystsResult] = React.useState(false);
  const [analystsTicker, setAnalystsTicker] = React.useState('');

  const [adhocAnswerText, setAdhocAnswerText] = React.useState('');
  const [hasAdhocResult, setHasAdhocResult] = React.useState(false);
  const [adhocTicker, setAdhocTicker] = React.useState('');
  const [adhocQuestionInput, setAdhocQuestionInput] = React.useState('');
  const [adhocWordLimit, setAdhocWordLimit] = React.useState(100);
  const [adhocHistoryTicker, setAdhocHistoryTicker] = React.useState('');

  const [dilutionResult, setDilutionResult] = React.useState(null);
  const [hasDilutionResult, setHasDilutionResult] = React.useState(false);
  const [dilutionTicker, setDilutionTicker] = React.useState('');
  const [dilutionHorizonDays, setDilutionHorizonDays] = React.useState(90);

  const [loadingByTab, setLoadingByTab] = React.useState({ runway: false, news: false, analysts: false, adhoc: false, dilution: false });
  const [errorsByTab, setErrorsByTab] = React.useState({ runway: '', news: '', analysts: '', adhoc: '', dilution: '' });

  const requestSeqByTabRef = React.useRef({ runway: 0, news: 0, analysts: 0, adhoc: 0, dilution: 0 });
  const abortControllerByTabRef = React.useRef({ runway: null, news: null, analysts: null, adhoc: null, dilution: null });

  const [showLogs, setShowLogs] = React.useState(false);
  const [logKind, setLogKind] = React.useState('server');
  const [logText, setLogText] = React.useState('');
  const [logError, setLogError] = React.useState('');
  const [lastLogFetchAt, setLastLogFetchAt] = React.useState(null);

  const [xaiMetrics, setXaiMetrics] = React.useState({ total: 0, success: 0, failure: 0 });
  const [geminiMetrics, setGeminiMetrics] = React.useState({ total: 0, success: 0, failure: 0 });

  const [showSettings, setShowSettings] = React.useState(false);
  const [settingsStatus, setSettingsStatus] = React.useState({
    xai: { configured: false, masked: '' },
    gemini: { configured: false, masked: '' }
  });
  const [xaiKeyInput, setXaiKeyInput] = React.useState('');
  const [geminiKeyInput, setGeminiKeyInput] = React.useState('');
  const [settingsSaving, setSettingsSaving] = React.useState(false);
  const [settingsError, setSettingsError] = React.useState('');
  const [settingsFeedback, setSettingsFeedback] = React.useState(null);

  React.useEffect(() => {
    if (tab === 'discord' || tab === 'dilution') return;
    let cancelled = false;

    if (tab === 'discord') {
      return () => {
        cancelled = true;
      };
    }

    async function loadMetrics() {
      try {
        const resp = await fetch('/api/metrics');
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) return;
        if (!cancelled && data?.xai) {
          setXaiMetrics({
            total: Number(data.xai.total || 0),
            success: Number(data.xai.success || 0),
            failure: Number(data.xai.failure || 0)
          });
        }

        if (!cancelled && data?.gemini) {
          setGeminiMetrics({
            total: Number(data.gemini.total || 0),
            success: Number(data.gemini.success || 0),
            failure: Number(data.gemini.failure || 0)
          });
        }
      } catch {
        // ignore
      }
    }

    loadMetrics();
    const id = setInterval(loadMetrics, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  React.useEffect(() => {
    if (tab === 'discord' || tab === 'ticker') return;
    let cancelled = false;

    async function load() {
      try {
        setModelsError('');
        const [xaiModels, geminiModels] = await Promise.all([fetchModels('xai'), fetchModels('gemini')]);
        if (!cancelled) {
          setModelsByProvider({ xai: xaiModels, gemini: geminiModels });
        }
      } catch (e) {
        if (!cancelled) {
          setModelsError(e instanceof Error ? e.message : 'Failed to load models');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setHistoryErrorByTab((prev) => ({ ...prev, [tab]: '' }));
        const items = await fetchHistory(tab);
        if (!cancelled) {
          setHistoryByTab((prev) => ({ ...prev, [tab]: items }));

          if (tab === 'adhoc') {
            const preferred = (tickerInput || adhocTicker || '').trim().toUpperCase();
            if (preferred && !adhocHistoryTicker) {
              setAdhocHistoryTicker(preferred);
            }
          }
        }
      } catch (e) {
        if (!cancelled) {
          setHistoryErrorByTab((prev) => ({
            ...prev,
            [tab]: e instanceof Error ? e.message : 'Failed to load history'
          }));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  React.useEffect(() => {
    if (tab !== 'adhoc') return;
    const preferred = tickerInput.trim().toUpperCase();
    if (preferred && !adhocHistoryTicker) {
      setAdhocHistoryTicker(preferred);
    }
  }, [tab, tickerInput, adhocHistoryTicker]);

  React.useEffect(() => {
    if (!showLogs) return;

    let cancelled = false;

    async function loadLogs() {
      try {
        setLogError('');
        const endpoint =
          logKind === 'xai'
            ? '/api/xai-logs?lines=400'
            : logKind === 'gemini'
              ? '/api/gemini-logs?lines=400'
              : '/api/logs?lines=400';
        const resp = await fetch(endpoint);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(data?.error || `Failed to load logs (${resp.status})`);
        }
        const text = Array.isArray(data?.lines) ? data.lines.join('\n') : '';
        if (!cancelled) {
          setLogText(text);
          setLastLogFetchAt(new Date());
        }
      } catch (e) {
        if (!cancelled) {
          setLogError(e instanceof Error ? e.message : 'Failed to load logs');
        }
      }
    }

    loadLogs();
    const id = setInterval(loadLogs, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showLogs, logKind]);

  React.useEffect(() => {
    if (!showSettings) return;

    let cancelled = false;
    async function load() {
      try {
        setSettingsError('');
        const data = await fetchSettings();
        if (!cancelled) {
          setSettingsStatus({
            xai: {
              configured: Boolean(data?.xai?.configured),
              masked: typeof data?.xai?.masked === 'string' ? data.xai.masked : ''
            },
            gemini: {
              configured: Boolean(data?.gemini?.configured),
              masked: typeof data?.gemini?.masked === 'string' ? data.gemini.masked : ''
            }
          });
        }
      } catch (e) {
        if (!cancelled) setSettingsError(e instanceof Error ? e.message : 'Failed to load settings');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [showSettings]);

  async function onSaveSettings({ clearProvider } = {}) {
    try {
      setSettingsSaving(true);
      setSettingsError('');
      setSettingsFeedback(null);

      const payload = { test: true };
      if (clearProvider === 'xai') payload.xaiApiKey = '';
      else if (xaiKeyInput.trim()) payload.xaiApiKey = xaiKeyInput.trim();

      if (clearProvider === 'gemini') payload.geminiApiKey = '';
      else if (geminiKeyInput.trim()) payload.geminiApiKey = geminiKeyInput.trim();

      const res = await saveSettings(payload);
      if (res?.saved) {
        setSettingsStatus({
          xai: {
            configured: Boolean(res.saved?.xai?.configured),
            masked: typeof res.saved?.xai?.masked === 'string' ? res.saved.xai.masked : ''
          },
          gemini: {
            configured: Boolean(res.saved?.gemini?.configured),
            masked: typeof res.saved?.gemini?.masked === 'string' ? res.saved.gemini.masked : ''
          }
        });
      }
      setSettingsFeedback(res?.tests || null);
      setXaiKeyInput('');
      setGeminiKeyInput('');
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  }

  async function onTestProvider(provider) {
    try {
      setSettingsError('');
      const res = await testSettings(provider);
      setSettingsFeedback((prev) => ({ ...(prev || {}), [provider]: { ok: Boolean(res.ok), detail: res.detail } }));
    } catch (e) {
      setSettingsFeedback((prev) => ({
        ...(prev || {}),
        [provider]: { ok: false, detail: { error: e instanceof Error ? e.message : 'Test failed' } }
      }));
    }
  }

  async function onSubmit(e) {
    e.preventDefault();

    const activeTab = tab;
    setErrorsByTab((prev) => ({ ...prev, [activeTab]: '' }));

    const ticker = tickerInput.trim().toUpperCase();
    const provider = providerByTab[activeTab] || 'xai';
    const model = modelByTab?.[activeTab]?.[provider] || '';

    if (!ticker) {
      setErrorsByTab((prev) => ({ ...prev, [activeTab]: 'Enter a ticker symbol.' }));
      return;
    }

    if (activeTab === 'adhoc') {
      const q = adhocQuestionInput.trim();
      if (!q) {
        setErrorsByTab((prev) => ({ ...prev, adhoc: 'Enter a question (or use a preset button).' }));
        return;
      }
    }

    requestSeqByTabRef.current[activeTab] += 1;
    const requestSeq = requestSeqByTabRef.current[activeTab];
    abortControllerByTabRef.current[activeTab]?.abort();
    const controller = new AbortController();
    abortControllerByTabRef.current[activeTab] = controller;

    setLoadingByTab((prev) => ({ ...prev, [activeTab]: true }));
    try {
      if (activeTab === 'runway') {
        setRunway(null);
        setHasRunwayResult(false);
        const result = await fetchRunwayMonths(ticker, provider, { signal: controller.signal, model });
        if (requestSeqByTabRef.current[activeTab] !== requestSeq) return;
        setRunway(result.runway || null);
        setHasRunwayResult(true);
        setRunwayTicker(ticker);
      } else if (activeTab === 'news') {
        setNews(null);
        setHasNewsResult(false);
        const result = await fetchNews(ticker, provider, { signal: controller.signal, model });
        if (requestSeqByTabRef.current[activeTab] !== requestSeq) return;
        setNews(result.news || null);
        setHasNewsResult(true);
        setNewsTicker(ticker);
      } else if (activeTab === 'analysts') {
        setAnalysts(null);
        setHasAnalystsResult(false);
        const result = await fetchAnalysts(ticker, provider, { signal: controller.signal, model });
        if (requestSeqByTabRef.current[activeTab] !== requestSeq) return;
        setAnalysts(result.analysts || null);
        setHasAnalystsResult(true);
        setAnalystsTicker(ticker);
      } else if (activeTab === 'dilution') {
        setDilutionResult(null);
        setHasDilutionResult(false);

        const horizon = Math.max(7, Math.min(365, Number(dilutionHorizonDays) || 90));
        const result = await fetchDilutionAnalysis(ticker, provider, {
          signal: controller.signal,
          model,
          horizonDays: horizon
        });
        if (requestSeqByTabRef.current[activeTab] !== requestSeq) return;

        setDilutionResult(result || null);
        setHasDilutionResult(true);
        setDilutionTicker(ticker);
        if (typeof result?.horizonDays === 'number') setDilutionHorizonDays(result.horizonDays);
      } else if (activeTab === 'adhoc') {
        setAdhocAnswerText('');
        setHasAdhocResult(false);

        const wl = Math.max(10, Math.min(500, Number(adhocWordLimit) || 100));
        const result = await fetchAdhoc({
          ticker,
          provider,
          model,
          question: adhocQuestionInput,
          wordLimit: wl,
          signal: controller.signal
        });
        if (requestSeqByTabRef.current[activeTab] !== requestSeq) return;

        setAdhocAnswerText(String(result?.answerText || ''));
        setHasAdhocResult(true);
        setAdhocTicker(ticker);

        if (typeof result?.question === 'string') setAdhocQuestionInput(result.question);
        if (typeof result?.wordLimit === 'number') setAdhocWordLimit(result.wordLimit);
      }

      // Refresh history list for this tab after a successful query.
      try {
        const items = await fetchHistory(activeTab);
        setHistoryByTab((prev) => ({ ...prev, [activeTab]: items }));
      } catch {
        // ignore
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
        return;
      }
      setErrorsByTab((prev) => ({
        ...prev,
        [activeTab]: err instanceof Error ? err.message : 'Unknown error'
      }));
    } finally {
      if (requestSeqByTabRef.current[activeTab] === requestSeq) {
        setLoadingByTab((prev) => ({ ...prev, [activeTab]: false }));
      }
    }
  }

  async function onPickHistoryTicker(valueOrEvent) {
    const picked =
      typeof valueOrEvent === 'string'
        ? valueOrEvent
        : valueOrEvent && typeof valueOrEvent === 'object' && 'target' in valueOrEvent
          ? valueOrEvent.target?.value
          : '';
    if (!picked) return;

    if (tab === 'adhoc') {
      setErrorsByTab((prev) => ({ ...prev, adhoc: '' }));
      try {
        const item = await fetchHistoryItem({ tab: 'adhoc', id: picked });

        if (item?.provider) {
          setProviderByTab((prev) => ({ ...prev, adhoc: item.provider }));
        }
        if (item?.provider && item?.model) {
          setModelByTab((prev) => ({
            ...prev,
            adhoc: {
              ...prev.adhoc,
              [item.provider]: item.model
            }
          }));
        }

        setTickerInput(item?.ticker || '');
        setAdhocTicker(item?.ticker || '');
        setAdhocQuestionInput(item?.question || '');
        setAdhocWordLimit(typeof item?.wordLimit === 'number' ? item.wordLimit : 100);
        setAdhocAnswerText(item?.answerText || '');
        setHasAdhocResult(true);
      } catch (err) {
        setErrorsByTab((prev) => ({
          ...prev,
          adhoc: err instanceof Error ? err.message : 'Failed to load saved result'
        }));
      }
      return;
    }

    const provider = providerByTab[tab] || 'xai';
    setTickerInput(picked);
    setErrorsByTab((prev) => ({ ...prev, [tab]: '' }));

    try {
      // Prefer loading the entry for the currently selected provider.
      let item;
      try {
        item = await fetchHistoryItem({ tab, ticker: picked, provider });
      } catch {
        // Fallback: load the most recent entry regardless of provider.
        item = await fetchHistoryItem({ tab, ticker: picked });
      }

      if (item?.provider) {
        setProviderByTab((prev) => ({ ...prev, [tab]: item.provider }));
      }
      if (item?.provider && item?.model) {
        setModelByTab((prev) => ({
          ...prev,
          [tab]: {
            ...prev[tab],
            [item.provider]: item.model
          }
        }));
      }

      if (tab === 'runway') {
        setRunway(item?.payload?.runway || null);
        setHasRunwayResult(true);
        setRunwayTicker(picked);
      } else if (tab === 'news') {
        setNews(item?.payload?.news || null);
        setHasNewsResult(true);
        setNewsTicker(picked);
      } else if (tab === 'analysts') {
        setAnalysts(item?.payload?.analysts || null);
        setHasAnalystsResult(true);
        setAnalystsTicker(picked);
      } else if (tab === 'dilution') {
        const saved = item?.payload?.dilution || null;
        setDilutionResult(saved ? { ticker: picked, provider: item?.provider, model: item?.model, ...saved } : null);
        setHasDilutionResult(Boolean(saved));
        setDilutionTicker(picked);
        if (typeof saved?.horizonDays === 'number') setDilutionHorizonDays(saved.horizonDays);
      }
    } catch (err) {
      setErrorsByTab((prev) => ({
        ...prev,
        [tab]: err instanceof Error ? err.message : 'Failed to load saved result'
      }));
    }
  }

  const tabError = errorsByTab[tab] || '';
  const currentTicker =
    tab === 'runway'
      ? runwayTicker
      : tab === 'news'
        ? newsTicker
        : tab === 'analysts'
          ? analystsTicker
          : tab === 'adhoc'
            ? adhocTicker
            : tab === 'dilution'
              ? dilutionTicker
            : '';

  const tabBusy = {
    runway: Boolean(loadingByTab.runway),
    news: Boolean(loadingByTab.news),
    analysts: Boolean(loadingByTab.analysts),
    adhoc: Boolean(loadingByTab.adhoc),
    dilution: Boolean(loadingByTab.dilution),
    discord: false
  };

  const adhocTickers = React.useMemo(() => {
    const list = Array.isArray(historyByTab?.adhoc) ? historyByTab.adhoc : [];
    const set = new Set();
    for (const it of list) {
      const t = typeof it?.ticker === 'string' ? it.ticker.trim().toUpperCase() : '';
      if (t) set.add(t);
    }
    return Array.from(set).sort();
  }, [historyByTab?.adhoc]);

  const adhocHistoryItemsForTicker = React.useMemo(() => {
    const list = Array.isArray(historyByTab?.adhoc) ? historyByTab.adhoc : [];
    const t = typeof adhocHistoryTicker === 'string' ? adhocHistoryTicker.trim().toUpperCase() : '';
    if (!t) return list;
    return list.filter((it) => String(it?.ticker || '').trim().toUpperCase() === t);
  }, [historyByTab?.adhoc, adhocHistoryTicker]);

  const recentTickers = React.useMemo(() => {
    const all = [];
    for (const key of ['runway', 'news', 'analysts', 'dilution']) {
      const items = Array.isArray(historyByTab?.[key]) ? historyByTab[key] : [];
      for (const it of items) {
        const t = typeof it?.ticker === 'string' ? it.ticker.trim().toUpperCase() : '';
        if (!t) continue;
        const ts = it?.updatedAt ? new Date(it.updatedAt).getTime() : 0;
        all.push({ ticker: t, ts });
      }
    }

    const adhocItems = Array.isArray(historyByTab?.adhoc) ? historyByTab.adhoc : [];
    for (const it of adhocItems) {
      const t = typeof it?.ticker === 'string' ? it.ticker.trim().toUpperCase() : '';
      if (!t) continue;
      const ts = it?.updatedAt ? new Date(it.updatedAt).getTime() : 0;
      all.push({ ticker: t, ts });
    }

    all.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    const out = [];
    const seen = new Set();
    for (const row of all) {
      if (seen.has(row.ticker)) continue;
      seen.add(row.ticker);
      out.push(row.ticker);
      if (out.length >= 80) break;
    }
    return out;
  }, [historyByTab]);

  const pageSubtitle =
    tab === 'runway'
      ? 'Cash runway (months) from xAI'
      : tab === 'ticker'
        ? 'Ticker: shared context across tabs'
        : tab === 'news'
          ? 'News: split/dilution + positivity by time bucket'
          : tab === 'analysts'
            ? 'Analysts: sentiment by time bucket'
            : tab === 'dilution'
              ? 'Dilution: SEC evidence + explainable risk score + AI summary'
              : tab === 'discord'
                ? 'Discord: live feed (Playwright)'
                : 'Ad-hoc stock questions';

  const navItems = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'runway', label: 'Runway' },
    { key: 'news', label: 'News' },
    { key: 'analysts', label: 'Analysts' },
    { key: 'adhoc', label: 'Ad-hoc' },
    { key: 'dilution', label: 'Dilution' },
    { key: 'discord', label: 'Discord' }
  ];

  function goTo(nextTab) {
    closeNav();
    navigate(pathFromTab(nextTab));
  }

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={navOpened} onClick={toggleNav} hiddenFrom="sm" size="sm" />
            <Group gap="sm" align="center" wrap="nowrap">
              <img className="logo" src="/logo.png" alt="marketmind logo" loading="eager" />
              <div>
                <Text fw={700} size="lg">
                  marketmind
                </Text>
                <Text c="dimmed" size="xs">
                  {pageSubtitle}
                </Text>
              </div>
            </Group>
          </Group>

          <Group gap="xs" wrap="nowrap">
            <div className="pill" title="xAI request results since server start">
              xAI: {xaiMetrics.success} ok / {xaiMetrics.failure} fail
            </div>
            <div className="pill" title="Gemini request results since server start">
              Gemini: {geminiMetrics.success} ok / {geminiMetrics.failure} fail
            </div>
            <Button
              variant="default"
              size="sm"
              type="button"
              onClick={() => setShowLogs((s) => !s)}
              aria-pressed={showLogs}
            >
              {showLogs ? 'Hide logs' : 'Show logs'}
            </Button>
            <Button variant="default" size="sm" type="button" onClick={() => setShowSettings(true)}>
              Settings
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea style={{ height: '100%' }}>
          {navItems.map((it) => (
            <NavLink key={it.key} label={it.label} active={tab === it.key} onClick={() => goTo(it.key)} />
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <div className="page">
          <div className="layout">
            <div className="card">

          {tab === 'discord' ? null : tab === 'ticker' ? (
            <div className="row">
              <TextInput
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                placeholder="Ticker (e.g., AAPL)"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          ) : tab === 'adhoc' ? (
            <form onSubmit={onSubmit} className="row rowAdhoc">
              <Select
                w={120}
                data={[
                  { value: 'xai', label: 'xAI' },
                  { value: 'gemini', label: 'Gemini' }
                ]}
                value={providerByTab[tab]}
                onChange={(value) => {
                  if (!value) return;
                  setProviderByTab((prev) => ({ ...prev, [tab]: value }));
                }}
                aria-label="Provider"
              />
              <Select
                w={240}
                value={modelByTab?.[tab]?.[providerByTab[tab]] || null}
                placeholder={modelsError ? '(models failed to load)' : '(loading models…)'}
                disabled={(() => {
                  const provider = providerByTab[tab];
                  const selected = modelByTab?.[tab]?.[provider] || '';
                  const list = modelsByProvider[provider] || [];
                  return !selected && !list.length;
                })()}
                data={(() => {
                  const provider = providerByTab[tab];
                  const selected = modelByTab?.[tab]?.[provider] || '';
                  const list = modelsByProvider[provider] || [];
                  const options = selected && !list.includes(selected) ? [selected, ...list] : list;
                  return options.map((m) => ({ value: m, label: m }));
                })()}
                onChange={(value) => {
                  const provider = providerByTab[tab];
                  const next = value || '';
                  setModelByTab((prev) => ({
                    ...prev,
                    [tab]: {
                      ...prev[tab],
                      [provider]: next
                    }
                  }));
                }}
                aria-label="Model"
              />
              <TextInput
                w={200}
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                placeholder="Ticker (e.g., AAPL)"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />

              <Select
                w={160}
                value={adhocHistoryTicker || null}
                onChange={(value) => {
                  const next = value || '';
                  setAdhocHistoryTicker(next);
                  if (!tickerInput.trim() && next) setTickerInput(next);
                }}
                data={adhocTickers.map((t) => ({ value: t, label: t }))}
                placeholder="History stock…"
                clearable
                aria-label="History stock"
                title="Choose which stock's ad-hoc history to show"
              />

              <NumberInput
                w={140}
                min={10}
                max={500}
                step={10}
                value={adhocWordLimit}
                onChange={(value) => setAdhocWordLimit(value ?? '')}
                aria-label="Max words"
                title="Max words (10-500)"
              />
              <Select
                w={220}
                value={adhocHistoryPickerId}
                onChange={(value) => {
                  if (!value) return;
                  setAdhocHistoryPickerId(value);
                  onPickHistoryTicker(value).finally(() => setAdhocHistoryPickerId(null));
                }}
                data={adhocHistoryItemsForTicker.map((it) => ({ value: it.id, label: it.label || it.id }))}
                placeholder="History…"
                aria-label="History"
                title="Load a saved ad-hoc query from today"
              />
              <Button type="submit" loading={loadingByTab[tab]}>
                {loadingByTab[tab] ? 'Asking…' : 'Ask'}
              </Button>

              <div className="adhocControls">
                <div className="presetRow" role="group" aria-label="Presets">
                  <Button
                    type="button"
                    variant="light"
                    size="xs"
                    onClick={() => setAdhocQuestionInput('What is the cash runway and dilution risk for this stock?')}
                  >
                    Runway + dilution
                  </Button>
                  <Button type="button" variant="light" size="xs" onClick={() => setAdhocQuestionInput('What news can move this stock today?')}>
                    News today
                  </Button>
                  <Button
                    type="button"
                    variant="light"
                    size="xs"
                    onClick={() => setAdhocQuestionInput('What are analysts saying about this stock right now?')}
                  >
                    Analyst views
                  </Button>
                  <Button
                    type="button"
                    variant="light"
                    size="xs"
                    onClick={() => setAdhocQuestionInput('What are social media views and sentiment on this stock today?')}
                  >
                    Social sentiment
                  </Button>
                </div>
                <Textarea
                  value={adhocQuestionInput}
                  onChange={(e) => setAdhocQuestionInput(e.target.value)}
                  placeholder="Ask anything about this stock…"
                  autosize
                  minRows={3}
                />
              </div>
            </form>
          ) : tab === 'dilution' ? (
            <form onSubmit={onSubmit} className="row">
              <select
                className="select"
                value={providerByTab[tab]}
                onChange={(e) => setProviderByTab((prev) => ({ ...prev, [tab]: e.target.value }))}
                aria-label="Provider"
                title="Choose which API to query"
              >
                <option value="xai">xAI</option>
                <option value="gemini">Gemini</option>
              </select>
              <select
                className="select"
                value={modelByTab?.[tab]?.[providerByTab[tab]] || ''}
                onChange={(e) => {
                  const provider = providerByTab[tab];
                  const value = e.target.value;
                  setModelByTab((prev) => ({
                    ...prev,
                    [tab]: {
                      ...prev[tab],
                      [provider]: value
                    }
                  }));
                }}
                aria-label="Model"
                title="Choose model"
              >
                {(() => {
                  const provider = providerByTab[tab];
                  const selected = modelByTab?.[tab]?.[provider] || '';
                  const list = modelsByProvider[provider] || [];
                  const options = selected && !list.includes(selected) ? [selected, ...list] : list;

                  if (!options.length) {
                    return <option value="">{modelsError ? '(models failed to load)' : '(loading models…)'} </option>;
                  }

                  return options.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ));
                })()}
              </select>
              <input
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                placeholder="Ticker (e.g., AAPL)"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="input"
              />

              <select
                className="select"
                value={String(dilutionHorizonDays)}
                onChange={(e) => setDilutionHorizonDays(Number(e.target.value))}
                aria-label="Horizon"
                title="How far back to scan filings"
              >
                <option value={30}>30d horizon</option>
                <option value={60}>60d horizon</option>
                <option value={90}>90d horizon</option>
                <option value={180}>180d horizon</option>
              </select>

              <select
                className="select"
                value=""
                onChange={onPickHistoryTicker}
                aria-label="History"
                title="Load a saved result from today"
              >
                <option value="">History…</option>
                {(historyByTab[tab] || []).map((it) => (
                  <option key={it.ticker} value={it.ticker}>
                    {it.ticker}
                  </option>
                ))}
              </select>

              <button className="button" disabled={loadingByTab[tab]}>
                {loadingByTab[tab] ? 'Analyzing…' : 'Analyze'}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setDilutionResult(null);
                  setHasDilutionResult(false);
                  setDilutionTicker('');
                  setErrorsByTab((prev) => ({ ...prev, dilution: '' }));
                }}
                disabled={loadingByTab[tab]}
              >
                Clear
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmit} className="row">
            <select
              className="select"
              value={providerByTab[tab]}
              onChange={(e) => setProviderByTab((prev) => ({ ...prev, [tab]: e.target.value }))}
              aria-label="Provider"
              title="Choose which API to query"
            >
              <option value="xai">xAI</option>
              <option value="gemini">Gemini</option>
            </select>
            <select
              className="select"
              value={modelByTab?.[tab]?.[providerByTab[tab]] || ''}
              onChange={(e) => {
                const provider = providerByTab[tab];
                const value = e.target.value;
                setModelByTab((prev) => ({
                  ...prev,
                  [tab]: {
                    ...prev[tab],
                    [provider]: value
                  }
                }));
              }}
              aria-label="Model"
              title="Choose model"
            >
              {(() => {
                const provider = providerByTab[tab];
                const selected = modelByTab?.[tab]?.[provider] || '';
                const list = modelsByProvider[provider] || [];
                const options = selected && !list.includes(selected) ? [selected, ...list] : list;

                if (!options.length) {
                  return <option value="">{modelsError ? '(models failed to load)' : '(loading models…)'} </option>;
                }

                return options.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ));
              })()}
            </select>
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder="Ticker (e.g., AAPL)"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="input"
            />
            <select
              className="select"
              value=""
              onChange={onPickHistoryTicker}
              aria-label="History"
              title="Load a saved result from today"
            >
              <option value="">History…</option>
              {(historyByTab[tab] || []).map((it) => (
                <option key={it.ticker} value={it.ticker}>
                  {it.ticker}
                </option>
              ))}
            </select>
            <button className="button" disabled={loadingByTab[tab]}>
              {loadingByTab[tab]
                ? 'Asking…'
                : tab === 'runway'
                  ? 'Get runway'
                  : tab === 'news'
                    ? 'Get news'
                    : 'Get analyst sentiment'}
            </button>
            </form>
          )}

          <div className="results">
            <div style={{ display: tab === 'discord' ? 'block' : 'none' }}>
              <DiscordTab />
            </div>

            <div style={{ display: tab === 'ticker' ? 'block' : 'none' }}>
              <TickerTab
                ticker={tickerInput}
                onTickerChange={setTickerInput}
                recentTickers={recentTickers}
              />
            </div>

            <div style={{ display: tab === 'dilution' ? 'block' : 'none' }}>
              <DilutionTab
                ticker={tickerInput}
                overview={dilutionResult?.overview || null}
                charts={dilutionResult?.charts || null}
                ai={dilutionResult?.ai || null}
                loading={loadingByTab.dilution}
                error={errorsByTab.dilution}
              />
            </div>

            <div style={{ display: tab === 'discord' || tab === 'dilution' || tab === 'ticker' ? 'none' : 'block' }}>
              <div>
                <div className="label">Current ticker</div>
                <div className="value">{currentTicker || '—'}</div>
              </div>

            {tab === 'runway' ? (
              <>
                <div>
                  <div className="label">Cash runway</div>
                  <div className="value">
                    {!hasRunwayResult
                      ? '—'
                      : runway?.accurate?.runwayMonths === null && runway?.estimate?.runwayMonths === null
                        ? 'Insufficient data'
                        : formatMonths(runway?.accurate?.runwayMonths ?? runway?.estimate?.runwayMonths)}
                  </div>
                </div>

                <div className="grid2">
                  <div className="box">
                    <div className="label">Accurate (sourced)</div>
                    <div className="miniRow">
                      <div className="miniLabel">Cash on hand</div>
                      <div className="miniValue">{formatUsd(runway?.accurate?.cashOnHandUsd)}</div>
                    </div>
                    <div className="miniRow">
                      <div className="miniLabel">Burn rate / month</div>
                      <div className="miniValue">{formatUsd(runway?.accurate?.burnRateUsdPerMonth)}</div>
                    </div>
                    <div className="miniRow">
                      <div className="miniLabel">Runway</div>
                      <div className="miniValue">{formatMonths(runway?.accurate?.runwayMonths)}</div>
                    </div>
                  </div>

                  <div className="box">
                    <div className="label">Best estimate</div>
                    <div className="miniRow">
                      <div className="miniLabel">Cash on hand</div>
                      <div className="miniValue">{formatUsd(runway?.estimate?.cashOnHandUsd)}</div>
                    </div>
                    <div className="miniRow">
                      <div className="miniLabel">Burn rate / month</div>
                      <div className="miniValue">{formatUsd(runway?.estimate?.burnRateUsdPerMonth)}</div>
                    </div>
                    <div className="miniRow">
                      <div className="miniLabel">Runway</div>
                      <div className="miniValue">{formatMonths(runway?.estimate?.runwayMonths)}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="label">Sources</div>
                  <div className="sources">
                    {!hasRunwayResult || !runway?.sources?.length ? (
                      <div className="muted">—</div>
                    ) : (
                      <ul className="sourceList">
                        {runway.sources.map((u) => (
                          <li key={u}>
                            <a href={u} target="_blank" rel="noreferrer">
                              {u}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : tab === 'adhoc' ? (
              <>
                <div className="box full">
                  <div className="label">Answer</div>
                  <div className="mono prewrap">{hasAdhocResult ? adhocAnswerText || '—' : '—'}</div>
                </div>
              </>
            ) : null}

            {tab === 'news' ? (
              <>
                <div>
                  <div className="label">Split / dilution in next month</div>
                  <div className="sources">
                    {!hasNewsResult ? (
                      <div className="muted">—</div>
                    ) : !news?.splitDilutionNextMonth?.length ? (
                      <div className="muted">None detected</div>
                    ) : (
                      <div className="tableList">
                        {sortByPublishedAtDesc(news.splitDilutionNextMonth).map((it) => (
                          <div key={it.url} className="tableRow">
                            <div className="tableCell time">{formatDateTime(it.publishedAt)}</div>
                            <div className="tableCell">
                              <strong>{it.corporateAction}</strong>: <a href={it.url} target="_blank" rel="noreferrer">{it.headline}</a>
                              {it.note ? <span className="muted"> — {it.note}</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="label">News positivity (percent positive)</div>
                  <BucketGrid buckets={news?.positivity} mode="pct" />
                </div>

                <div>
                  <div className="label">Recent articles</div>
                  <div className="sources">
                    {!hasNewsResult || !news?.articles?.length ? (
                      <div className="muted">—</div>
                    ) : (
                      <div className="tableList">
                        {sortByPublishedAtDesc(news.articles).map((a) => (
                          <div key={a.url} className="tableRow">
                            <div className="tableCell time">{formatDateTime(a.publishedAt)}</div>
                            <div className="tableCell">
                              <span className={`tag ${a.sentiment}`}>{a.sentiment}</span>{' '}
                              <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : null}

            {tab === 'analysts' ? (
              <>
                <div>
                  <div className="label">Analyst sentiment (percent positive)</div>
                  <BucketGrid buckets={analysts?.sentiment} mode="pct" />
                </div>
                {hasAnalystsResult && analysts?.consensusPriceTargets ? (
                  <div>
                    <div className="label">Consensus price targets</div>
                    <div className="sources">
                      <div className="value">{formatConsensusTargets(analysts.consensusPriceTargets)}</div>
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="label">Recent analyst items</div>
                  <div className="sources">
                    {!hasAnalystsResult || !analysts?.items?.length ? (
                      <div className="muted">—</div>
                    ) : (
                      <div className="tableList">
                        {sortByPublishedAtDesc(analysts.items).map((it) => (
                          <div key={it.url} className="tableRow">
                            <div className="tableCell time">{formatDateTime(it.publishedAt)}</div>
                            <div className="tableCell">
                              <span className={`tag ${it.sentiment}`}>{it.sentiment}</span>{' '}
                              {it.action && it.action !== 'none' ? (
                                <span className="muted">[{it.action}] </span>
                              ) : null}
                              {it.firm ? <span className="muted">{it.firm} </span> : null}
                              {formatPriceTarget({ fromUsd: it.priceTargetFromUsd, toUsd: it.priceTargetToUsd }) ? (
                                <span className="muted">
                                  {formatPriceTarget({
                                    fromUsd: it.priceTargetFromUsd,
                                    toUsd: it.priceTargetToUsd
                                  })}{' '}
                                </span>
                              ) : it.action === 'pt_raise' || it.action === 'pt_cut' ? (
                                <span className="muted" title="Price-target action detected, but the source text did not include a numeric $ target.">
                                  PT unavailable{' '}
                                </span>
                              ) : null}
                              <a href={it.url} target="_blank" rel="noreferrer">{it.title}</a>
                              {it.note ? <span className="muted"> — {it.note}</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : null}

                {modelsError ? <div className="error">{modelsError}</div> : null}
                {historyErrorByTab[tab] ? <div className="error">{historyErrorByTab[tab]}</div> : null}
                {tabError ? <div className="error">{tabError}</div> : null}
            </div>
          </div>
        </div>

        <Drawer
          opened={showLogs}
          onClose={() => setShowLogs(false)}
          position="right"
          size="xl"
          title={logKind === 'xai' ? 'xAI log' : logKind === 'gemini' ? 'Gemini log' : 'Server log'}
        >
          <Stack gap="sm">
            <SegmentedControl
              value={logKind}
              onChange={setLogKind}
              data={[
                { label: 'Server', value: 'server' },
                { label: 'xAI', value: 'xai' },
                { label: 'Gemini', value: 'gemini' }
              ]}
            />
            <Text c="dimmed" size="xs">
              {lastLogFetchAt ? `Updated ${lastLogFetchAt.toLocaleTimeString()}` : 'Loading…'}
            </Text>
            {logError ? (
              <Text c="red" size="sm">
                {logError}
              </Text>
            ) : null}
            <ScrollArea style={{ height: 'calc(100vh - 220px)' }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{logText || 'No logs yet.'}</pre>
            </ScrollArea>
          </Stack>
        </Drawer>
      </div>

      <Modal
        opened={showSettings}
        onClose={() => setShowSettings(false)}
        title="API keys"
        size="lg"
      >
        <Stack gap="md">
          <Text c="dimmed" size="sm">
            Keys are stored locally in your SQLite DB. They are never shown back in full.
          </Text>

          <Stack gap="sm">
            <Group align="end" wrap="wrap">
              <TextInput
                label="xAI key"
                type="password"
                value={xaiKeyInput}
                onChange={(e) => setXaiKeyInput(e.target.value)}
                placeholder={settingsStatus.xai.configured ? `Stored: ${settingsStatus.xai.masked}` : 'Paste xAI API key'}
                autoComplete="off"
                spellCheck={false}
                style={{ flex: '1 1 320px' }}
              />
              <Button variant="default" type="button" onClick={() => onTestProvider('xai')}>
                Test
              </Button>
              <Button
                variant="default"
                type="button"
                onClick={() => onSaveSettings({ clearProvider: 'xai' })}
                disabled={settingsSaving}
              >
                Clear
              </Button>
            </Group>

            <Group align="end" wrap="wrap">
              <TextInput
                label="Gemini key"
                type="password"
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                placeholder={settingsStatus.gemini.configured ? `Stored: ${settingsStatus.gemini.masked}` : 'Paste Gemini API key'}
                autoComplete="off"
                spellCheck={false}
                style={{ flex: '1 1 320px' }}
              />
              <Button variant="default" type="button" onClick={() => onTestProvider('gemini')}>
                Test
              </Button>
              <Button
                variant="default"
                type="button"
                onClick={() => onSaveSettings({ clearProvider: 'gemini' })}
                disabled={settingsSaving}
              >
                Clear
              </Button>
            </Group>
          </Stack>

          <Group justify="flex-end">
            <Button type="button" onClick={() => onSaveSettings()} loading={settingsSaving}>
              {settingsSaving ? 'Saving…' : 'Save & test'}
            </Button>
          </Group>

          {settingsError ? (
            <Text c="red" size="sm">
              {settingsError}
            </Text>
          ) : null}

          {settingsFeedback ? (
            <Stack gap={6}>
              <Text fw={600} size="sm">
                Connectivity
              </Text>
              <Group gap="md" wrap="wrap">
                <Text size="sm">
                  xAI: {settingsFeedback?.xai ? (settingsFeedback.xai.ok ? 'OK' : `Error: ${settingsFeedback.xai.detail?.error || 'failed'}`) : '—'}
                </Text>
                <Text size="sm">
                  Gemini:{' '}
                  {settingsFeedback?.gemini
                    ? settingsFeedback.gemini.ok
                      ? 'OK'
                      : `Error: ${settingsFeedback.gemini.detail?.error || 'failed'}`
                    : '—'}
                </Text>
              </Group>
            </Stack>
          ) : null}
        </Stack>
      </Modal>
    </div>
      </AppShell.Main>
    </AppShell>
  );
}
