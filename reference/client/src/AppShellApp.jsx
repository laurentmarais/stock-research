import React from 'react';
import {
  AppShell,
  Badge,
  Box,
  Burger,
  Button,
  Container,
  Drawer,
  Group,
  Modal,
  NavLink,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import DiscordTab from './DiscordTab.jsx';
import DilutionTab from './DilutionTab.jsx';
import HistoryTab from './HistoryTab.jsx';
import TickerTab from './TickerTab.jsx';
import RunwayTab from './tabs/RunwayTab.jsx';
import NewsTab from './tabs/NewsTab.jsx';
import AnalystsTab from './tabs/AnalystsTab.jsx';
import ValueTab from './tabs/ValueTab.jsx';
import CatOutTab from './tabs/CatOutTab.jsx';
import AdhocTab from './tabs/AdhocTab.jsx';
import ResearchTab from './tabs/ResearchTab.jsx';

const TAB_KEYS = ['ticker', 'runway', 'news', 'analysts', 'value', 'catout', 'adhoc', 'research', 'dilution', 'history', 'discord'];

function tabFromPathname(pathname) {
  const p = typeof pathname === 'string' ? pathname : '';
  if (p === '/' || p === '') return 'runway';
  const seg = p.split('/').filter(Boolean)[0] || '';
  const key = seg.toLowerCase();
  return TAB_KEYS.includes(key) ? key : 'runway';
}

function pathFromTab(tab) {
  const t = typeof tab === 'string' ? tab.trim().toLowerCase() : '';
  if (!t || t === 'runway') return '/runway';
  return `/${t}`;
}

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `Request failed (${resp.status})`);
  }
  return data;
}

async function fetchCompany(ticker, { signal } = {}) {
  const qp = new URLSearchParams({ ticker });
  return fetchJson(`/api/company?${qp.toString()}`, { signal });
}

async function fetchRunwayMonths(ticker, provider, { signal, model } = {}) {
  const qp = new URLSearchParams({ ticker, provider });
  if (model) qp.set('model', model);
  return fetchJson(`/api/runway?${qp.toString()}`, { signal });
}

async function fetchNews(ticker, provider, { signal, model } = {}) {
  const qp = new URLSearchParams({ ticker, provider });
  if (model) qp.set('model', model);
  return fetchJson(`/api/news?${qp.toString()}`, { signal });
}

async function fetchAnalysts(ticker, provider, { signal, model } = {}) {
  const qp = new URLSearchParams({ ticker, provider });
  if (model) qp.set('model', model);
  return fetchJson(`/api/analysts?${qp.toString()}`, { signal });
}

async function fetchValueReport(ticker, provider, { signal, model } = {}) {
  const qp = new URLSearchParams({ ticker, provider });
  if (model) qp.set('model', model);
  return fetchJson(`/api/value?${qp.toString()}`, { signal });
}

async function fetchCatOutReport(ticker, provider, { signal, model } = {}) {
  const qp = new URLSearchParams({ ticker, provider });
  if (model) qp.set('model', model);
  return fetchJson(`/api/catout?${qp.toString()}`, { signal });
}

async function fetchDilutionAnalysis(ticker, provider, { signal, model, horizonDays } = {}) {
  const qp = new URLSearchParams({ ticker, provider });
  if (model) qp.set('model', model);
  if (typeof horizonDays === 'number' && Number.isFinite(horizonDays)) {
    qp.set('horizonDays', String(horizonDays));
  }
  return fetchJson(`/api/dilution/analyze?${qp.toString()}`, { signal });
}

async function fetchAdhoc({ ticker, provider, model, question, wordLimit, signal } = {}) {
  return fetchJson('/api/adhoc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ ticker, provider, model, question, wordLimit })
  });
}

async function fetchModels(provider) {
  const data = await fetchJson(`/api/models?provider=${encodeURIComponent(provider)}`);
  if (provider === 'gemini') {
    const list = Array.isArray(data?.generateContentModels) ? data.generateContentModels : data?.models;
    return Array.isArray(list) ? list : [];
  }
  return Array.isArray(data?.models) ? data.models : [];
}

async function fetchHistory(tab) {
  const data = await fetchJson(`/api/history?tab=${encodeURIComponent(tab)}`);
  return Array.isArray(data?.items) ? data.items : [];
}

async function fetchHistoryItem({ tab, ticker, provider, id }) {
  const qp = new URLSearchParams({ tab });
  if (id) qp.set('id', id);
  if (ticker) qp.set('ticker', ticker);
  if (provider) qp.set('provider', provider);
  return fetchJson(`/api/history/item?${qp.toString()}`);
}

async function fetchSettings() {
  return fetchJson('/api/settings');
}

async function saveSettings({ xaiApiKey, geminiApiKey, pushoverAppToken, pushoverUserKey, test }) {
  const body = { test: Boolean(test) };
  if (typeof xaiApiKey === 'string') body.xaiApiKey = xaiApiKey;
  if (typeof geminiApiKey === 'string') body.geminiApiKey = geminiApiKey;
  if (typeof pushoverAppToken === 'string') body.pushoverAppToken = pushoverAppToken;
  if (typeof pushoverUserKey === 'string') body.pushoverUserKey = pushoverUserKey;
  return fetchJson('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function testSettings(provider) {
  return fetchJson('/api/settings/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider })
  });
}

async function fetchMetrics() {
  return fetchJson('/api/metrics');
}

async function fetchLogs(kind, { lines = 500, signal } = {}) {
  const qp = new URLSearchParams({ lines: String(lines) });
  const path = kind === 'xai' ? '/api/xai-logs' : kind === 'gemini' ? '/api/gemini-logs' : '/api/logs';
  return fetchJson(`${path}?${qp.toString()}`, { signal });
}

function formatUsd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function ResolvedCompanyHeader({ ticker, company }) {
  const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  const name = typeof company?.name === 'string' ? company.name.trim() : '';
  const exchange = typeof company?.exchange === 'string' ? company.exchange.trim() : '';
  const via = typeof company?.resolvedVia === 'string' ? company.resolvedVia.trim() : '';

  if (!t && !name) return null;

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap={4}>
        <Text fw={900} size="lg">
          {name || 'Company not resolved'}
        </Text>
        <Group gap="xs" wrap="wrap">
          {t ? <Badge variant="light">{t}</Badge> : null}
          {exchange ? <Badge variant="light">{exchange}</Badge> : null}
          {via ? (
            <Badge variant="light" title="How this company name was resolved">
              {via}
            </Badge>
          ) : null}
        </Group>
      </Stack>
    </Paper>
  );
}

export default function AppShellApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = React.useMemo(() => tabFromPathname(location.pathname), [location.pathname]);
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);

  React.useEffect(() => {
    const desired = pathFromTab(tabFromPathname(location.pathname));
    if (location.pathname !== desired) {
      navigate(desired, { replace: true });
    }
  }, [location.pathname, navigate]);

  const [tickerInput, setTickerInput] = React.useState('');
  const [providerByTab, setProviderByTab] = React.useState({
    runway: 'gemini',
    news: 'gemini',
    analysts: 'gemini',
    value: 'gemini',
    catout: 'gemini',
    adhoc: 'gemini',
    dilution: 'gemini'
  });
  const [modelByTab, setModelByTab] = React.useState({
    runway: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    news: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    analysts: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    value: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    catout: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    adhoc: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' },
    dilution: { xai: 'grok-4-1-fast-reasoning', gemini: 'models/gemini-2.5-pro' }
  });

  const [modelsByProvider, setModelsByProvider] = React.useState({ xai: [], gemini: [] });
  const [modelsError, setModelsError] = React.useState('');

  const [historyByTab, setHistoryByTab] = React.useState({ runway: [], news: [], analysts: [], value: [], catout: [], adhoc: [], dilution: [], research: [] });
  const [historyErrorByTab, setHistoryErrorByTab] = React.useState({ runway: '', news: '', analysts: '', value: '', catout: '', adhoc: '', dilution: '' });
  const [historyPickerValue, setHistoryPickerValue] = React.useState(null);
  const [adhocHistoryPickerId, setAdhocHistoryPickerId] = React.useState(null);

  const [companyByTab, setCompanyByTab] = React.useState({
    runway: null,
    news: null,
    analysts: null,
    value: null,
    catout: null,
    adhoc: null,
    dilution: null
  });

  const [companyByTicker, setCompanyByTicker] = React.useState({});
  const [companyOverrideSaving, setCompanyOverrideSaving] = React.useState(false);
  const [companyPanelError, setCompanyPanelError] = React.useState('');
  const [companyOverrideInput, setCompanyOverrideInput] = React.useState('');

  const [tickerLookupLoading, setTickerLookupLoading] = React.useState(false);
  const [tickerLookupError, setTickerLookupError] = React.useState('');
  const [tickerOverrideError, setTickerOverrideError] = React.useState('');

  const [runway, setRunway] = React.useState(null);
  const [runwayTicker, setRunwayTicker] = React.useState('');
  const [hasRunwayResult, setHasRunwayResult] = React.useState(false);

  const [news, setNews] = React.useState(null);
  const [newsTicker, setNewsTicker] = React.useState('');
  const [hasNewsResult, setHasNewsResult] = React.useState(false);

  const [analysts, setAnalysts] = React.useState(null);
  const [analystsTicker, setAnalystsTicker] = React.useState('');
  const [hasAnalystsResult, setHasAnalystsResult] = React.useState(false);

  const [valueReportText, setValueReportText] = React.useState('');
  const [valueEstimates, setValueEstimates] = React.useState(null);
  const [valueTicker, setValueTicker] = React.useState('');
  const [hasValueResult, setHasValueResult] = React.useState(false);

  const [catOutReportText, setCatOutReportText] = React.useState('');
  const [catOutTicker, setCatOutTicker] = React.useState('');
  const [hasCatOutResult, setHasCatOutResult] = React.useState(false);

  const [adhocAnswerText, setAdhocAnswerText] = React.useState('');
  const [hasAdhocResult, setHasAdhocResult] = React.useState(false);
  const [adhocQuestionInput, setAdhocQuestionInput] = React.useState('');
  const [adhocWordLimit, setAdhocWordLimit] = React.useState(100);
  const [adhocHistoryTicker, setAdhocHistoryTicker] = React.useState('');

  const [dilutionResult, setDilutionResult] = React.useState(null);
  const [dilutionTicker, setDilutionTicker] = React.useState('');
  const [hasDilutionResult, setHasDilutionResult] = React.useState(false);
  const [dilutionHorizonDays, setDilutionHorizonDays] = React.useState(90);

  const [loadingByTab, setLoadingByTab] = React.useState({ runway: false, news: false, analysts: false, value: false, catout: false, adhoc: false, dilution: false });
  const [errorsByTab, setErrorsByTab] = React.useState({ runway: '', news: '', analysts: '', value: '', catout: '', adhoc: '', dilution: '' });

  const [showSettings, setShowSettings] = React.useState(false);
  const [settingsStatus, setSettingsStatus] = React.useState({
    xai: { configured: false, masked: '' },
    gemini: { configured: false, masked: '' },
    pushover: { configured: false, tokenMasked: '', userMasked: '' }
  });
  const [xaiKeyInput, setXaiKeyInput] = React.useState('');
  const [geminiKeyInput, setGeminiKeyInput] = React.useState('');
  const [pushoverTokenInput, setPushoverTokenInput] = React.useState('');
  const [pushoverUserInput, setPushoverUserInput] = React.useState('');
  const [settingsSaving, setSettingsSaving] = React.useState(false);
  const [settingsError, setSettingsError] = React.useState('');
  const [settingsFeedback, setSettingsFeedback] = React.useState(null);

  const [showLogs, setShowLogs] = React.useState(false);
  const [logKind, setLogKind] = React.useState('server');
  const [logText, setLogText] = React.useState('');
  const [logError, setLogError] = React.useState('');
  const [lastLogFetchAt, setLastLogFetchAt] = React.useState(null);

  const [xaiMetrics, setXaiMetrics] = React.useState({ success: 0, failure: 0 });
  const [geminiMetrics, setGeminiMetrics] = React.useState({ success: 0, failure: 0 });

  const activeProvider = providerByTab[tab] || 'xai';
  const activeModel = modelByTab?.[tab]?.[activeProvider] || '';

  const modelDataForActive = React.useMemo(() => {
    const list = modelsByProvider[activeProvider] || [];
    const options = activeModel && !list.includes(activeModel) ? [activeModel, ...list] : list;
    return options.map((m) => ({ value: m, label: m }));
  }, [activeModel, activeProvider, modelsByProvider]);

  const pageSubtitle =
    tab === 'runway'
      ? 'Cash runway (months)'
      : tab === 'ticker'
        ? 'Ticker: shared context'
        : tab === 'research'
          ? 'Manual research notes'
        : tab === 'news'
          ? 'News: split/dilution + positivity'
          : tab === 'analysts'
            ? 'Analysts: sentiment'
            : tab === 'value'
              ? 'Value: intrinsic valuation + range'
              : tab === 'catout'
                ? 'Cat out of bag: catalysts + rumors + dates'
            : tab === 'dilution'
              ? 'Dilution: SEC evidence + risk score + AI summary'
              : tab === 'history'
                ? 'History: stored results'
              : tab === 'discord'
                ? 'Discord: live feed'
                : 'Ad-hoc stock questions';

  const navItems = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'runway', label: 'Runway' },
    { key: 'news', label: 'News' },
    { key: 'analysts', label: 'Analysts' },
    { key: 'value', label: 'Value' },
    { key: 'catout', label: 'Cat out of bag' },
    { key: 'adhoc', label: 'Ad-hoc' },
    { key: 'research', label: 'Research' },
    { key: 'dilution', label: 'Dilution' },
    { key: 'history', label: 'History' },
    { key: 'discord', label: 'Discord' }
  ];

  const recentTickers = React.useMemo(() => {
    const all = [];
    for (const key of Object.keys(historyByTab)) {
      const list = historyByTab[key];
      if (Array.isArray(list)) all.push(...list);
    }
    const out = [];
    const seen = new Set();
    for (const row of all) {
      if (!row?.ticker || seen.has(row.ticker)) continue;
      seen.add(row.ticker);
      out.push(row.ticker);
      if (out.length >= 80) break;
    }
    return out;
  }, [historyByTab]);

  const adhocTickers = React.useMemo(() => {
    const items = historyByTab.adhoc || [];
    const seen = new Set();
    const out = [];
    for (const it of items) {
      if (!it?.ticker || seen.has(it.ticker)) continue;
      seen.add(it.ticker);
      out.push(it.ticker);
    }
    return out;
  }, [historyByTab.adhoc]);

  const adhocHistoryItemsForTicker = React.useMemo(() => {
    const items = historyByTab.adhoc || [];
    const picked = (adhocHistoryTicker || '').trim();
    if (!picked) return items;
    return items.filter((it) => it.ticker === picked);
  }, [adhocHistoryTicker, historyByTab.adhoc]);

  function goTo(nextTab) {
    closeNav();
    navigate(pathFromTab(nextTab));
  }

  function normalizedTicker() {
    return (tickerInput || '').trim().toUpperCase();
  }

  function getCompanyForTicker(ticker) {
    const t = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
    if (!t) return null;
    const c = companyByTicker?.[t];
    return c && typeof c === 'object' ? c : null;
  }

  async function refreshCompanyForTicker(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return null;
    try {
      const resolved = await fetchCompany(t);
      const company = resolved?.company || null;
      setCompanyByTicker((prev) => ({ ...prev, [t]: company }));
      return company;
    } catch {
      return null;
    }
  }

  async function lookupCompanyForTicker(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    setTickerLookupError('');
    setTickerLookupLoading(true);
    try {
      await refreshCompanyForTicker(t);
    } catch (e) {
      setTickerLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setTickerLookupLoading(false);
    }
  }

  async function saveCompanyOverrideForTicker(ticker, name) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    setCompanyPanelError('');
    setCompanyOverrideSaving(true);
    try {
      await fetchJson('/api/company/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t, name: String(name || '') })
      });
      const company = await refreshCompanyForTicker(t);
      // Keep per-tab company views in sync when they currently show this ticker.
      setCompanyByTab((prev) => {
        const out = { ...prev };
        for (const k of Object.keys(out)) {
          const ct = String(out[k]?.ticker || '').trim().toUpperCase();
          if (ct && ct === t) out[k] = company;
        }
        return out;
      });
    } catch (e) {
      setCompanyPanelError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompanyOverrideSaving(false);
    }
  }

  async function saveOverrideFromTickerTab() {
    const t = normalizedTicker();
    if (!t) return;
    setTickerOverrideError('');
    try {
      await saveCompanyOverrideForTicker(t, companyOverrideInput);
      await lookupCompanyForTicker(t);
    } catch (e) {
      setTickerOverrideError(e instanceof Error ? e.message : String(e));
    }
  }

  function canRunTab(tabKey) {
    const ticker = normalizedTicker();
    if (!ticker) return false;
    if (tabKey === 'runway' || tabKey === 'news' || tabKey === 'analysts' || tabKey === 'value' || tabKey === 'catout' || tabKey === 'dilution') return true;
    if (tabKey === 'adhoc') return Boolean(String(adhocQuestionInput || '').trim());
    return false;
  }

  async function runQueryForTab(tabKey) {
    const activeTab = tabKey;
    if (!['runway', 'news', 'analysts', 'value', 'catout', 'adhoc', 'dilution'].includes(activeTab)) return;

    const provider = providerByTab[activeTab] || 'xai';
    const model = modelByTab?.[activeTab]?.[provider] || '';
    const ticker = normalizedTicker();

    setErrorsByTab((prev) => ({ ...prev, [activeTab]: '' }));

    if (activeTab !== 'adhoc' && !ticker) {
      setErrorsByTab((prev) => ({ ...prev, [activeTab]: 'Ticker is required.' }));
      return;
    }

    if (activeTab === 'adhoc') {
      const q = (adhocQuestionInput || '').trim();
      if (!ticker) {
        setErrorsByTab((prev) => ({ ...prev, adhoc: 'Ticker is required.' }));
        return;
      }
      if (!q) {
        setErrorsByTab((prev) => ({ ...prev, adhoc: 'Question is required.' }));
        return;
      }
    }

    setLoadingByTab((prev) => ({ ...prev, [activeTab]: true }));

    try {
      // Best-effort: tab endpoints resolve company server-side; never hard-fail the UI here.
      setCompanyByTab((prev) => ({ ...prev, [activeTab]: null }));

      if (activeTab === 'runway') {
        const result = await fetchRunwayMonths(ticker, provider, { model });
        setRunway(result?.runway || null);
        setHasRunwayResult(true);
        setRunwayTicker(result?.ticker || ticker);
        if (result?.company) {
          setCompanyByTab((prev) => ({ ...prev, runway: result.company }));
          setCompanyByTicker((prev) => ({ ...prev, [String(result?.ticker || ticker).toUpperCase()]: result.company }));
        }
      } else if (activeTab === 'news') {
        const result = await fetchNews(ticker, provider, { model });
        setNews(result?.news || null);
        setHasNewsResult(true);
        setNewsTicker(result?.ticker || ticker);
        if (result?.company) {
          setCompanyByTab((prev) => ({ ...prev, news: result.company }));
          setCompanyByTicker((prev) => ({ ...prev, [String(result?.ticker || ticker).toUpperCase()]: result.company }));
        }
      } else if (activeTab === 'analysts') {
        const result = await fetchAnalysts(ticker, provider, { model });
        setAnalysts(result?.analysts || null);
        setHasAnalystsResult(true);
        setAnalystsTicker(result?.ticker || ticker);
        if (result?.company) {
          setCompanyByTab((prev) => ({ ...prev, analysts: result.company }));
          setCompanyByTicker((prev) => ({ ...prev, [String(result?.ticker || ticker).toUpperCase()]: result.company }));
        }
      } else if (activeTab === 'value') {
        const result = await fetchValueReport(ticker, provider, { model });
        setValueReportText(typeof result?.reportText === 'string' ? result.reportText : '');
        setValueEstimates(result?.estimates && typeof result.estimates === 'object' ? result.estimates : null);
        setHasValueResult(true);
        setValueTicker(result?.ticker || ticker);
        if (result?.company) {
          setCompanyByTab((prev) => ({ ...prev, value: result.company }));
          setCompanyByTicker((prev) => ({ ...prev, [String(result?.ticker || ticker).toUpperCase()]: result.company }));
        }
      } else if (activeTab === 'catout') {
        const result = await fetchCatOutReport(ticker, provider, { model });
        setCatOutReportText(typeof result?.reportText === 'string' ? result.reportText : '');
        setHasCatOutResult(true);
        setCatOutTicker(result?.ticker || ticker);
        if (result?.company) {
          setCompanyByTab((prev) => ({ ...prev, catout: result.company }));
          setCompanyByTicker((prev) => ({ ...prev, [String(result?.ticker || ticker).toUpperCase()]: result.company }));
        }
      } else if (activeTab === 'dilution') {
        const result = await fetchDilutionAnalysis(ticker, provider, { model, horizonDays: dilutionHorizonDays });
        setDilutionResult(result);
        setHasDilutionResult(true);
        setDilutionTicker(ticker);
        if (result?.company) {
          setCompanyByTab((prev) => ({ ...prev, dilution: result.company }));
          setCompanyByTicker((prev) => ({ ...prev, [String(ticker).toUpperCase()]: result.company }));
        }
      } else if (activeTab === 'adhoc') {
        const wl = Math.max(10, Math.min(500, Number(adhocWordLimit) || 100));
        const result = await fetchAdhoc({
          ticker,
          provider,
          model,
          question: adhocQuestionInput,
          wordLimit: wl
        });
        if (typeof result?.answerText === 'string') setAdhocAnswerText(result.answerText);
        setHasAdhocResult(true);
        if (result?.company) {
          setCompanyByTab((prev) => ({ ...prev, adhoc: result.company }));
          setCompanyByTicker((prev) => ({ ...prev, [String(ticker).toUpperCase()]: result.company }));
        }
      }

      try {
        const items = await fetchHistory(activeTab);
        setHistoryByTab((prev) => ({ ...prev, [activeTab]: items }));
      } catch {
        // ignore
      }
    } catch (e2) {
      setErrorsByTab((prev) => ({ ...prev, [activeTab]: e2 instanceof Error ? e2.message : 'Unknown error' }));
    } finally {
      setLoadingByTab((prev) => ({ ...prev, [activeTab]: false }));
    }
  }

  function runFromSidebar(tabKey) {
    goTo(tabKey);
    runQueryForTab(tabKey);
  }

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setModelsError('');
      try {
        const [xai, gemini] = await Promise.all([fetchModels('xai'), fetchModels('gemini')]);
        if (cancelled) return;
        setModelsByProvider({ xai, gemini });
      } catch (e) {
        if (cancelled) return;
        setModelsError(e instanceof Error ? e.message : 'Failed to load models');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!['runway', 'news', 'analysts', 'value', 'catout', 'adhoc', 'dilution', 'research'].includes(tab)) return;
    let cancelled = false;
    setHistoryErrorByTab((prev) => ({ ...prev, [tab]: '' }));
    fetchHistory(tab)
      .then((items) => {
        if (cancelled) return;
        setHistoryByTab((prev) => ({ ...prev, [tab]: items }));
      })
      .catch((e) => {
        if (cancelled) return;
        setHistoryErrorByTab((prev) => ({ ...prev, [tab]: e instanceof Error ? e.message : 'Failed to load history' }));
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  React.useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const data = await fetchMetrics();
        if (cancelled) return;
        setXaiMetrics(data?.xai || { success: 0, failure: 0 });
        setGeminiMetrics(data?.gemini || { success: 0, failure: 0 });
      } catch {
        // ignore
      }
    }
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  React.useEffect(() => {
    if (!showLogs) return;
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setLogError('');
      try {
        const kind = logKind === 'xai' ? 'xai' : logKind === 'gemini' ? 'gemini' : 'server';
        const data = await fetchLogs(kind, { lines: 700, signal: controller.signal });
        if (cancelled) return;
        const lines = Array.isArray(data?.lines) ? data.lines : [];
        setLogText(lines.join('\n'));
        setLastLogFetchAt(new Date());
      } catch (e) {
        if (cancelled) return;
        setLogError(e instanceof Error ? e.message : 'Failed to load logs');
      }
    }

    load();
    const id = setInterval(load, 5000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [showLogs, logKind]);

  React.useEffect(() => {
    if (!showSettings) return;
    let cancelled = false;
    setSettingsError('');
    setSettingsFeedback(null);
    fetchSettings()
      .then((data) => {
        if (cancelled) return;
        setSettingsStatus({
          xai: data?.xai || { configured: false, masked: '' },
          gemini: data?.gemini || { configured: false, masked: '' },
          pushover: data?.pushover || { configured: false, tokenMasked: '', userMasked: '' }
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setSettingsError(e instanceof Error ? e.message : 'Failed to load settings');
      });
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

      if (clearProvider === 'pushover') {
        payload.pushoverAppToken = '';
        payload.pushoverUserKey = '';
      } else {
        if (pushoverTokenInput.trim()) payload.pushoverAppToken = pushoverTokenInput.trim();
        if (pushoverUserInput.trim()) payload.pushoverUserKey = pushoverUserInput.trim();
      }

      const res = await saveSettings(payload);
      if (res?.saved) {
        setSettingsStatus({
          xai: res.saved?.xai || { configured: false, masked: '' },
          gemini: res.saved?.gemini || { configured: false, masked: '' },
          pushover: res.saved?.pushover || { configured: false, tokenMasked: '', userMasked: '' }
        });
      }
      setSettingsFeedback(res?.tests || null);
      setXaiKeyInput('');
      setGeminiKeyInput('');
      setPushoverTokenInput('');
      setPushoverUserInput('');

      // reload model lists in case keys affect available models
      try {
        const [xai, gemini] = await Promise.all([fetchModels('xai'), fetchModels('gemini')]);
        setModelsByProvider({ xai, gemini });
      } catch {
        // ignore
      }
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

  async function onPickHistory(value) {
    if (!value) return;

    if (tab === 'adhoc') {
      setErrorsByTab((prev) => ({ ...prev, adhoc: '' }));
      try {
        const item = await fetchHistoryItem({ tab: 'adhoc', id: value });
        if (item?.provider) setProviderByTab((prev) => ({ ...prev, adhoc: item.provider }));
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
        setAdhocQuestionInput(item?.question || '');
        setAdhocWordLimit(typeof item?.wordLimit === 'number' ? item.wordLimit : 100);
        setAdhocAnswerText(item?.answerText || '');
        setHasAdhocResult(true);

        try {
          const resolved = await fetchCompany(item?.ticker || '');
          setCompanyByTab((prev) => ({ ...prev, adhoc: resolved?.company || null }));
          const t = String(item?.ticker || '').trim().toUpperCase();
          if (t && resolved?.company) setCompanyByTicker((prev) => ({ ...prev, [t]: resolved.company }));
        } catch {
          // ignore
        }
      } catch (e) {
        setErrorsByTab((prev) => ({ ...prev, adhoc: e instanceof Error ? e.message : 'Failed to load saved result' }));
      }
      return;
    }

    await loadSavedResultForTab({ tabKey: tab, ticker: value, alsoSetTickerInput: true });
  }

  async function loadSavedResultForTab({ tabKey, ticker, alsoSetTickerInput }) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    const tk = String(tabKey || '').trim().toLowerCase();
    if (!['runway', 'news', 'analysts', 'value', 'catout', 'dilution'].includes(tk)) return;

    if (alsoSetTickerInput) setTickerInput(t);
    setErrorsByTab((prev) => ({ ...prev, [tk]: '' }));
    setLoadingByTab((prev) => ({ ...prev, [tk]: true }));

    try {
      const provider = providerByTab[tk] || 'xai';
      let item;
      try {
        item = await fetchHistoryItem({ tab: tk, ticker: t, provider });
      } catch {
        item = await fetchHistoryItem({ tab: tk, ticker: t });
      }

      if (item?.provider) setProviderByTab((prev) => ({ ...prev, [tk]: item.provider }));
      if (item?.provider && item?.model) {
        setModelByTab((prev) => ({
          ...prev,
          [tk]: {
            ...prev[tk],
            [item.provider]: item.model
          }
        }));
      }

      if (tk === 'runway') {
        setRunway(item?.payload?.runway || null);
        setHasRunwayResult(true);
        setRunwayTicker(t);
      } else if (tk === 'news') {
        setNews(item?.payload?.news || null);
        setHasNewsResult(true);
        setNewsTicker(t);
      } else if (tk === 'analysts') {
        setAnalysts(item?.payload?.analysts || null);
        setHasAnalystsResult(true);
        setAnalystsTicker(t);
      } else if (tk === 'value') {
        setValueReportText(typeof item?.payload?.reportText === 'string' ? item.payload.reportText : '');
        setValueEstimates(item?.payload?.estimates && typeof item.payload.estimates === 'object' ? item.payload.estimates : null);
        setHasValueResult(true);
        setValueTicker(t);
      } else if (tk === 'catout') {
        setCatOutReportText(typeof item?.payload?.reportText === 'string' ? item.payload.reportText : '');
        setHasCatOutResult(true);
        setCatOutTicker(t);
      } else if (tk === 'dilution') {
        setDilutionResult(item?.payload?.dilution || null);
        setHasDilutionResult(true);
        setDilutionTicker(t);
      }

      const savedCompany = item?.payload?.company || null;
      if (savedCompany) {
        setCompanyByTab((prev) => ({ ...prev, [tk]: savedCompany }));
        setCompanyByTicker((prev) => ({ ...prev, [t]: savedCompany }));
      }

      const resolvedCompany = await refreshCompanyForTicker(t);
      if (resolvedCompany) {
        setCompanyByTab((prev) => ({ ...prev, [tk]: resolvedCompany }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load saved result';
      // Not found is expected: just clear stale results for this tab.
      if (String(msg).toLowerCase().includes('not found') || String(msg).includes('(404)')) {
        if (tk === 'runway') {
          setRunway(null);
          setHasRunwayResult(false);
          setRunwayTicker(t);
        } else if (tk === 'news') {
          setNews(null);
          setHasNewsResult(false);
          setNewsTicker(t);
        } else if (tk === 'analysts') {
          setAnalysts(null);
          setHasAnalystsResult(false);
          setAnalystsTicker(t);
        } else if (tk === 'value') {
          setValueReportText('');
          setValueEstimates(null);
          setValueEstimates(null);
          setHasValueResult(false);
          setValueTicker(t);
        } else if (tk === 'catout') {
          setCatOutReportText('');
          setHasCatOutResult(false);
          setCatOutTicker(t);
        } else if (tk === 'dilution') {
          setDilutionResult(null);
          setHasDilutionResult(false);
          setDilutionTicker(t);
        }
        setCompanyByTab((prev) => ({ ...prev, [tk]: getCompanyForTicker(t) || null }));
      } else {
        setErrorsByTab((prev) => ({ ...prev, [tk]: msg }));
      }
    } finally {
      setLoadingByTab((prev) => ({ ...prev, [tk]: false }));
    }
  }

  async function loadHistoricalAcrossTabs(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    setTickerInput(t);

    // Load/clear every applicable tab (best-effort).
    const tabs = ['runway', 'news', 'analysts', 'value', 'catout', 'dilution'];
    await Promise.allSettled(tabs.map((k) => loadSavedResultForTab({ tabKey: k, ticker: t, alsoSetTickerInput: false })));
  }

  async function onSubmit(e) {
    e?.preventDefault?.();
    await runQueryForTab(tab);
  }

  function onDeletedTicker(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    setHistoryByTab((prev) => {
      const out = { ...prev };
      for (const k of Object.keys(out)) {
        const list = Array.isArray(out[k]) ? out[k] : [];
        out[k] = list.filter((it) => String(it?.ticker || '').toUpperCase() !== t);
      }
      return out;
    });

    if (String(tickerInput || '').trim().toUpperCase() === t) {
      if (tab === 'value') {
        setValueReportText('');
        setValueEstimates(null);
        setHasValueResult(false);
        setValueTicker('');
      } else if (tab === 'catout') {
        setCatOutReportText('');
        setHasCatOutResult(false);
        setCatOutTicker('');
      }
    }

    setCompanyByTab((prev) => {
      const out = { ...prev };
      for (const k of Object.keys(out)) {
        const ct = String(out[k]?.ticker || '').trim().toUpperCase();
        if (ct && ct === t) out[k] = null;
      }
      return out;
    });

    setCompanyByTicker((prev) => {
      const out = { ...prev };
      delete out[t];
      return out;
    });
  }

  const currentTicker =
    tab === 'runway'
      ? runwayTicker
      : tab === 'news'
        ? newsTicker
        : tab === 'analysts'
          ? analystsTicker
          : tab === 'value'
            ? valueTicker
            : tab === 'catout'
              ? catOutTicker
          : tab === 'dilution'
            ? dilutionTicker
            : (tickerInput || '').trim().toUpperCase();

  const currentCompany = companyByTab?.[tab] || null;

  const panelTicker = normalizedTicker();
  const panelCompany =
    getCompanyForTicker(panelTicker) ||
    (String(currentCompany?.ticker || '').trim().toUpperCase() === panelTicker ? currentCompany : null);

  React.useEffect(() => {
    const t = panelTicker;
    if (!t) {
      setCompanyOverrideInput('');
      return;
    }
    // Populate override input from current resolved identity.
    const c = getCompanyForTicker(t);
    if (c && c.resolvedVia === 'override' && typeof c.name === 'string') {
      setCompanyOverrideInput(c.name);
    } else {
      setCompanyOverrideInput('');
    }
  }, [panelTicker, companyByTicker]);

  React.useEffect(() => {
    // Keep a global-by-ticker company cache warm so every tab can show identity consistently.
    const t = panelTicker;
    if (!t) return;
    let cancelled = false;
    setCompanyPanelError('');
    refreshCompanyForTicker(t)
      .catch(() => null)
      .finally(() => {
        // noop
      });
    return () => {
      cancelled = true;
    };
  }, [panelTicker]);

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
            <Badge variant="light" title="xAI request results since server start">
              xAI: {xaiMetrics.success} ok / {xaiMetrics.failure} fail
            </Badge>
            <Badge variant="light" title="Gemini request results since server start">
              Gemini: {geminiMetrics.success} ok / {geminiMetrics.failure} fail
            </Badge>
            <Button variant="default" size="sm" type="button" onClick={() => setShowLogs((s) => !s)}>
              {showLogs ? 'Hide logs' : 'Show logs'}
            </Button>
            <Button variant="default" size="sm" type="button" onClick={() => setShowSettings(true)}>
              Settings
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <Stack gap="sm" style={{ height: '100%' }}>
          <TextInput
            label="Ticker"
            value={tickerInput}
            onChange={(e) => {
              const next = e?.target?.value ?? '';
              setTickerInput(next);
              if (tab !== 'ticker') {
                navigate(pathFromTab('ticker'));
              }
            }}
            placeholder="AAPL"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <ScrollArea style={{ flex: 1 }}>
            {navItems.map((it) => {
              const disabled = !canRunTab(it.key);
              const isRunnable = ['runway', 'news', 'analysts', 'value', 'catout', 'dilution', 'adhoc'].includes(it.key);
              const loading = Boolean(loadingByTab[it.key]);

              return (
                <NavLink
                  key={it.key}
                  label={it.label}
                  active={tab === it.key}
                  onClick={() => goTo(it.key)}
                  rightSection={
                    isRunnable ? (
                      <Button
                        size="xs"
                        variant="subtle"
                        loading={loading}
                        disabled={disabled || loading}
                        onClick={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          runFromSidebar(it.key);
                        }}
                        title={
                          it.key === 'adhoc'
                            ? disabled
                              ? 'Set ticker and question to run'
                              : 'Run ad-hoc query'
                            : disabled
                              ? 'Set ticker to run'
                              : 'Run'
                        }
                      >
                        Run
                      </Button>
                    ) : null
                  }
                />
              );
            })}
          </ScrollArea>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Container size="lg">
          <Stack gap="md">
            <Paper withBorder radius="lg" p="md">
              <Box style={{ display: tab === 'discord' ? 'block' : 'none' }}>
                <DiscordTab />
              </Box>

              <Box style={{ display: tab === 'discord' ? 'none' : 'block' }}>
                {tab === 'ticker' ? (
                  <TickerTab
                    ticker={tickerInput}
                    onTickerChange={(t) => loadHistoricalAcrossTabs(t)}
                    recentTickers={recentTickers}
                    company={panelCompany}
                    companyByTicker={companyByTicker}
                    lookupLoading={tickerLookupLoading}
                    lookupError={tickerLookupError}
                    onLookupCompany={(t) => lookupCompanyForTicker(t)}
                    overrideName={companyOverrideInput}
                    onOverrideNameChange={setCompanyOverrideInput}
                    overrideSaving={companyOverrideSaving}
                    overrideError={tickerOverrideError || companyPanelError}
                    onSaveOverride={saveOverrideFromTickerTab}
                  />
                ) : tab === 'research' ? (
                  <ResearchTab
                    ticker={tickerInput}
                    onTickerChange={(next) => {
                      setTickerInput(next);
                    }}
                  />
                ) : tab === 'history' ? (
                  <HistoryTab onDeletedTicker={onDeletedTicker} />
                ) : (
                  <Stack gap="md">
                  {tab === 'adhoc' ? (
                    <form onSubmit={onSubmit}>
                      <Stack gap="sm">
                        <Group gap="sm" wrap="wrap" align="end">
                          <Select
                            w={120}
                            data={[
                              { value: 'xai', label: 'xAI' },
                              { value: 'gemini', label: 'Gemini' }
                            ]}
                            value={providerByTab.adhoc}
                            onChange={(value) => value && setProviderByTab((prev) => ({ ...prev, adhoc: value }))}
                            label="Provider"
                          />
                          <Select
                            w={280}
                            value={modelByTab?.adhoc?.[providerByTab.adhoc] || null}
                            data={(() => {
                              const provider = providerByTab.adhoc;
                              const selected = modelByTab?.adhoc?.[provider] || '';
                              const list = modelsByProvider[provider] || [];
                              const options = selected && !list.includes(selected) ? [selected, ...list] : list;
                              return options.map((m) => ({ value: m, label: m }));
                            })()}
                            placeholder={modelsError ? '(models failed to load)' : '(loading models…)'}
                            disabled={(() => {
                              const provider = providerByTab.adhoc;
                              const selected = modelByTab?.adhoc?.[provider] || '';
                              const list = modelsByProvider[provider] || [];
                              return !selected && !list.length;
                            })()}
                            onChange={(value) => {
                              const provider = providerByTab.adhoc;
                              const next = value || '';
                              setModelByTab((prev) => ({
                                ...prev,
                                adhoc: {
                                  ...prev.adhoc,
                                  [provider]: next
                                }
                              }));
                            }}
                            label="Model"
                          />
                          <Select
                            w={180}
                            value={adhocHistoryTicker || null}
                            onChange={(value) => {
                              const next = value || '';
                              setAdhocHistoryTicker(next);
                              if (!tickerInput.trim() && next) setTickerInput(next);
                            }}
                            data={adhocTickers.map((t) => ({ value: t, label: t }))}
                            placeholder="History stock…"
                            clearable
                            label="History stock"
                          />
                          <NumberInput
                            w={140}
                            min={10}
                            max={500}
                            step={10}
                            value={adhocWordLimit}
                            onChange={(value) => setAdhocWordLimit(value ?? '')}
                            label="Max words"
                          />
                          <Select
                            w={260}
                            value={adhocHistoryPickerId}
                            onChange={(value) => {
                              if (!value) return;
                              setAdhocHistoryPickerId(value);
                              onPickHistory(value).finally(() => setAdhocHistoryPickerId(null));
                            }}
                            data={adhocHistoryItemsForTicker.map((it) => ({ value: it.id, label: it.label || it.id }))}
                            placeholder="History…"
                            label="Load saved"
                          />
                          <Button type="submit" loading={loadingByTab.adhoc}>
                            Ask
                          </Button>
                        </Group>

                        <Group gap="xs" wrap="wrap">
                          <Button variant="light" size="xs" type="button" onClick={() => setAdhocQuestionInput('What is the cash runway and dilution risk for this stock?')}>
                            Runway + dilution
                          </Button>
                          <Button variant="light" size="xs" type="button" onClick={() => setAdhocQuestionInput('What news can move this stock today?')}>
                            News today
                          </Button>
                          <Button variant="light" size="xs" type="button" onClick={() => setAdhocQuestionInput('What are analysts saying about this stock right now?')}>
                            Analyst views
                          </Button>
                          <Button variant="light" size="xs" type="button" onClick={() => setAdhocQuestionInput('What are social media views and sentiment on this stock today?')}>
                            Social sentiment
                          </Button>
                        </Group>

                        <Textarea
                          value={adhocQuestionInput}
                          onChange={(e2) => setAdhocQuestionInput(e2.target.value)}
                          placeholder="Ask anything about this stock…"
                          autosize
                          minRows={3}
                        />
                      </Stack>
                    </form>
                  ) : (
                    <form onSubmit={onSubmit}>
                      <Group gap="sm" wrap="wrap" align="end">
                        <Select
                          w={120}
                          data={[
                            { value: 'xai', label: 'xAI' },
                            { value: 'gemini', label: 'Gemini' }
                          ]}
                          value={providerByTab[tab]}
                          onChange={(value) => value && setProviderByTab((prev) => ({ ...prev, [tab]: value }))}
                          label="Provider"
                        />
                        <Select
                          w={280}
                          value={activeModel || null}
                          data={modelDataForActive}
                          placeholder={modelsError ? '(models failed to load)' : '(loading models…)'}
                          disabled={!modelDataForActive.length}
                          onChange={(value) => {
                            const next = value || '';
                            const provider = providerByTab[tab];
                            setModelByTab((prev) => ({
                              ...prev,
                              [tab]: {
                                ...prev[tab],
                                [provider]: next
                              }
                            }));
                          }}
                          label="Model"
                        />
                        {tab === 'dilution' ? (
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
                            label="Horizon"
                          />
                        ) : null}
                        <Select
                          w={180}
                          value={historyPickerValue}
                          onChange={(value) => {
                            if (!value) return;
                            setHistoryPickerValue(value);
                            onPickHistory(value).finally(() => setHistoryPickerValue(null));
                          }}
                          data={(historyByTab[tab] || []).map((it) => ({ value: it.ticker, label: it.ticker }))}
                          placeholder="History…"
                          label="Load saved"
                        />

                        <Button type="submit" loading={loadingByTab[tab]}>
                          {tab === 'runway' ? 'Get runway' : tab === 'news' ? 'Get news' : tab === 'analysts' ? 'Get analyst sentiment' : 'Analyze'}
                        </Button>
                        {tab === 'dilution' ? (
                          <Button
                            variant="default"
                            type="button"
                            onClick={() => {
                              setDilutionResult(null);
                              setHasDilutionResult(false);
                              setDilutionTicker('');
                              setErrorsByTab((prev) => ({ ...prev, dilution: '' }));
                            }}
                            disabled={loadingByTab.dilution}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </Group>
                    </form>
                  )}

                  {modelsError ? (
                    <Text c="red" size="sm">
                      {modelsError}
                    </Text>
                  ) : null}
                  {historyErrorByTab[tab] ? (
                    <Text c="red" size="sm">
                      {historyErrorByTab[tab]}
                    </Text>
                  ) : null}
                  {errorsByTab[tab] ? (
                    <Text c="red" size="sm">
                      {errorsByTab[tab]}
                    </Text>
                  ) : null}

                  <Box>
                    {['runway', 'news', 'analysts', 'value', 'catout', 'adhoc', 'dilution'].includes(tab) ? (
                      <Stack gap="sm" mt="md">
                        <ResolvedCompanyHeader ticker={panelTicker} company={panelCompany} />
                        {companyPanelError ? (
                          <Text c="red" size="sm">
                            {companyPanelError}
                          </Text>
                        ) : null}
                      </Stack>
                    ) : null}

                    {tab === 'dilution' ? (
                      <Stack gap="md" mt="md">
                        <DilutionTab
                          ticker={tickerInput}
                          overview={dilutionResult?.overview || null}
                          charts={dilutionResult?.charts || null}
                          ai={dilutionResult?.ai || null}
                          loading={loadingByTab.dilution}
                          error={errorsByTab.dilution}
                        />
                      </Stack>
                    ) : tab === 'runway' ? (
                      <RunwayTab runway={runway} hasRunwayResult={hasRunwayResult} />
                    ) : tab === 'news' ? (
                      <NewsTab news={news} hasNewsResult={hasNewsResult} />
                    ) : tab === 'analysts' ? (
                      <AnalystsTab analysts={analysts} hasAnalystsResult={hasAnalystsResult} />
                    ) : tab === 'value' ? (
                      <ValueTab hasValueResult={hasValueResult} valueReportText={valueReportText} estimates={valueEstimates} />
                    ) : tab === 'catout' ? (
                      <CatOutTab hasCatOutResult={hasCatOutResult} catOutReportText={catOutReportText} />
                    ) : tab === 'adhoc' ? (
                      <AdhocTab hasAdhocResult={hasAdhocResult} adhocAnswerText={adhocAnswerText} />
                    ) : null}
                  </Box>
                </Stack>
                )}
              </Box>
            </Paper>
          </Stack>
        </Container>

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

        <Modal opened={showSettings} onClose={() => setShowSettings(false)} title="API keys" size="lg">
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
                  onChange={(e2) => setXaiKeyInput(e2.target.value)}
                  placeholder={settingsStatus.xai.configured ? `Stored: ${settingsStatus.xai.masked}` : 'Paste xAI API key'}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ flex: '1 1 320px' }}
                />
                <Button variant="default" type="button" onClick={() => onTestProvider('xai')}>
                  Test
                </Button>
                <Button variant="default" type="button" onClick={() => onSaveSettings({ clearProvider: 'xai' })} disabled={settingsSaving}>
                  Clear
                </Button>
              </Group>

              <Group align="end" wrap="wrap">
                <TextInput
                  label="Gemini key"
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e2) => setGeminiKeyInput(e2.target.value)}
                  placeholder={settingsStatus.gemini.configured ? `Stored: ${settingsStatus.gemini.masked}` : 'Paste Gemini API key'}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ flex: '1 1 320px' }}
                />
                <Button variant="default" type="button" onClick={() => onTestProvider('gemini')}>
                  Test
                </Button>
                <Button variant="default" type="button" onClick={() => onSaveSettings({ clearProvider: 'gemini' })} disabled={settingsSaving}>
                  Clear
                </Button>
              </Group>

              <Stack gap={6}>
                <Text fw={600} size="sm">
                  Pushover
                </Text>
                <TextInput
                  label="Pushover app token"
                  type="password"
                  value={pushoverTokenInput}
                  onChange={(e2) => setPushoverTokenInput(e2.target.value)}
                  placeholder={
                    settingsStatus.pushover.configured && settingsStatus.pushover.tokenMasked
                      ? `Stored: ${settingsStatus.pushover.tokenMasked}`
                      : 'Paste Pushover app token'
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <TextInput
                  label="Pushover user key"
                  type="password"
                  value={pushoverUserInput}
                  onChange={(e2) => setPushoverUserInput(e2.target.value)}
                  placeholder={
                    settingsStatus.pushover.configured && settingsStatus.pushover.userMasked
                      ? `Stored: ${settingsStatus.pushover.userMasked}`
                      : 'Paste Pushover user key'
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <Group justify="flex-start" gap="sm" wrap="wrap">
                  <Button variant="default" type="button" onClick={() => onTestProvider('pushover')}>
                    Test Pushover
                  </Button>
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => onSaveSettings({ clearProvider: 'pushover' })}
                    disabled={settingsSaving}
                  >
                    Clear Pushover
                  </Button>
                </Group>
              </Stack>
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
                    xAI:{' '}
                    {settingsFeedback?.xai
                      ? settingsFeedback.xai.ok
                        ? 'OK'
                        : `Error: ${settingsFeedback.xai.detail?.error || 'failed'}`
                      : '—'}
                  </Text>
                  <Text size="sm">
                    Gemini:{' '}
                    {settingsFeedback?.gemini
                      ? settingsFeedback.gemini.ok
                        ? 'OK'
                        : `Error: ${settingsFeedback.gemini.detail?.error || 'failed'}`
                      : '—'}
                  </Text>
                  <Text size="sm">
                    Pushover:{' '}
                    {settingsFeedback?.pushover
                      ? settingsFeedback.pushover.ok
                        ? 'OK'
                        : `Error: ${settingsFeedback.pushover.detail?.error || 'failed'}`
                      : '—'}
                  </Text>
                </Group>
              </Stack>
            ) : null}
          </Stack>
        </Modal>
      </AppShell.Main>
    </AppShell>
  );
}
