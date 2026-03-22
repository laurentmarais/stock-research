import React from 'react';
import {
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  NavLink,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title
} from '@mantine/core';
import { IconChartBar, IconChecklist, IconDatabase, IconMessage2, IconMoodSearch, IconPlayerPause, IconPlayerPlay, IconSettings, IconTargetArrow, IconTrash } from '@tabler/icons-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const TABS = [
  { key: 'tickers', label: 'Tickers', icon: IconTargetArrow },
  { key: 'market', label: 'Market Sentiment', icon: IconMoodSearch },
  { key: 'runner', label: 'Runner', icon: IconPlayerPlay },
  { key: 'questions', label: 'Questions', icon: IconChecklist },
  { key: 'instructions', label: 'Instructions', icon: IconMessage2 },
  { key: 'answers', label: 'Answers', icon: IconDatabase },
  { key: 'evaluation', label: 'Evaluation', icon: IconChartBar },
  { key: 'history', label: 'History', icon: IconTrash },
  { key: 'settings', label: 'Settings', icon: IconSettings }
];

function normalizeTicker(input) {
  return typeof input === 'string' ? input.trim().toUpperCase() : '';
}

function parseBulkTickers(input) {
  return [...new Set(String(input || '')
    .split(/[\s,;|/\\]+/)
    .map(normalizeTicker)
    .filter(Boolean))];
}

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `Request failed (${resp.status})`);
  }
  return data;
}

function renderMarkdown(md) {
  const html = marked.parse(typeof md === 'string' ? md : '', { gfm: true, breaks: true });
  return { __html: DOMPurify.sanitize(html) };
}

function ScoreBadge({ value }) {
  const num = Number(value);
  const color = num >= 4 ? 'green' : num >= 3 ? 'yellow' : 'red';
  return <Badge className="score-pill" color={color}>{Number.isFinite(num) ? num.toFixed(1) : '—'}</Badge>;
}

export default function App() {
  const [tab, setTab] = React.useState('tickers');
  const [search, setSearch] = React.useState('');
  const [selectedTicker, setSelectedTicker] = React.useState('');
  const [bulkInput, setBulkInput] = React.useState('');
  const [tickers, setTickers] = React.useState([]);
  const [tickersLoading, setTickersLoading] = React.useState(false);
  const [tickersError, setTickersError] = React.useState('');
  const [provider, setProvider] = React.useState('gemini');
  const [model, setModel] = React.useState('');
  const [models, setModels] = React.useState([]);
  const [overwriteAnswers, setOverwriteAnswers] = React.useState(false);
  const [overwriteEvaluations, setOverwriteEvaluations] = React.useState(false);
  const [settings, setSettings] = React.useState({ xai: { masked: '', configured: false }, gemini: { masked: '', configured: false } });
  const [settingsDraft, setSettingsDraft] = React.useState({ xaiApiKey: '', geminiApiKey: '' });
  const [settingsMessage, setSettingsMessage] = React.useState('');
  const [marketLatest, setMarketLatest] = React.useState(null);
  const [marketLoading, setMarketLoading] = React.useState(false);
  const [marketError, setMarketError] = React.useState('');
  const [questionGroups, setQuestionGroups] = React.useState([]);
  const [activeGroupId, setActiveGroupId] = React.useState('');
  const [questions, setQuestions] = React.useState([]);
  const [groupName, setGroupName] = React.useState('');
  const [newQuestion, setNewQuestion] = React.useState('');
  const [instructions, setInstructions] = React.useState('');
  const [instructionsMessage, setInstructionsMessage] = React.useState('');
  const [answers, setAnswers] = React.useState([]);
  const [answersTickerFilter, setAnswersTickerFilter] = React.useState('');
  const [evaluations, setEvaluations] = React.useState([]);
  const [selectedEvaluationId, setSelectedEvaluationId] = React.useState('');
  const [evaluationSearch, setEvaluationSearch] = React.useState('');
  const [evaluationAlignmentFilter, setEvaluationAlignmentFilter] = React.useState('');
  const [evaluationSortBy, setEvaluationSortBy] = React.useState('score');
  const [evaluationSortDirection, setEvaluationSortDirection] = React.useState('desc');
  const [history, setHistory] = React.useState([]);
  const [jobs, setJobs] = React.useState([]);
  const [jobActionLoading, setJobActionLoading] = React.useState(false);
  const [runnerPreview, setRunnerPreview] = React.useState({ all: null, selected: null });
  const [runnerPreviewLoading, setRunnerPreviewLoading] = React.useState(false);
  const [runnerPreviewError, setRunnerPreviewError] = React.useState('');
  const [evaluationPreview, setEvaluationPreview] = React.useState({ all: null, selected: null });
  const [evaluationPreviewLoading, setEvaluationPreviewLoading] = React.useState(false);
  const [evaluationPreviewError, setEvaluationPreviewError] = React.useState('');
  const [addLoading, setAddLoading] = React.useState(false);
  const [appError, setAppError] = React.useState('');
  const [selectedCompany, setSelectedCompany] = React.useState(null);
  const [companyLookupLoading, setCompanyLookupLoading] = React.useState(false);
  const [companyLookupError, setCompanyLookupError] = React.useState('');
  const [companyOverrideInput, setCompanyOverrideInput] = React.useState('');
  const [companyOverrideSaving, setCompanyOverrideSaving] = React.useState(false);
  const [companyOverrideError, setCompanyOverrideError] = React.useState('');

  const filteredTickers = React.useMemo(() => {
    const term = search.trim().toUpperCase();
    if (!term) return tickers;
    return tickers.filter((item) => {
      const ticker = normalizeTicker(item?.ticker);
      const name = String(item?.companyName || '').toUpperCase();
      return ticker.includes(term) || name.includes(term);
    });
  }, [search, tickers]);

  const latestJob = jobs[0] || null;

  async function loadTickers() {
    setTickersLoading(true);
    try {
      setTickersError('');
      const data = await fetchJson('/api/tickers');
      setTickers(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setTickersError(e instanceof Error ? e.message : 'Failed to load tickers');
    } finally {
      setTickersLoading(false);
    }
  }

  async function loadSelectedCompany(ticker = selectedTicker) {
    const normalized = normalizeTicker(ticker);
    if (!normalized) {
      setSelectedCompany(null);
      setCompanyLookupError('');
      setCompanyOverrideInput('');
      return;
    }

    setCompanyLookupLoading(true);
    try {
      setCompanyLookupError('');
      const [companyData, overrideData] = await Promise.all([
        fetchJson(`/api/company?ticker=${encodeURIComponent(normalized)}`),
        fetchJson(`/api/company/override?ticker=${encodeURIComponent(normalized)}`).catch(() => ({ override: null }))
      ]);
      setSelectedCompany(companyData?.company || null);
      setCompanyOverrideInput(overrideData?.override?.name || '');
    } catch (e) {
      setCompanyLookupError(e instanceof Error ? e.message : 'Failed to load company');
    } finally {
      setCompanyLookupLoading(false);
    }
  }

  async function loadSettings() {
    const data = await fetchJson('/api/settings');
    setSettings(data);
  }

  async function loadModels(nextProvider = provider) {
    try {
      const data = await fetchJson(`/api/models?provider=${encodeURIComponent(nextProvider)}`);
      const list = Array.isArray(data?.models) ? data.models : [];
      setModels(list);
      if (!model && list.length) setModel(list[0]);
    } catch {
      setModels([]);
    }
  }

  async function loadQuestionGroups() {
    const data = await fetchJson('/api/question-groups');
    const list = Array.isArray(data?.items) ? data.items : [];
    setQuestionGroups(list);
    const active = list.find((item) => item?.isActive) || list[0] || null;
    if (active) setActiveGroupId(active.id);
  }

  async function loadQuestions(groupId = activeGroupId) {
    if (!groupId) return;
    const data = await fetchJson(`/api/questions?groupId=${encodeURIComponent(groupId)}`);
    setQuestions(Array.isArray(data?.items) ? data.items : []);
  }

  async function loadInstructions() {
    const data = await fetchJson('/api/instructions');
    setInstructions(data?.body || '');
  }

  async function loadMarket() {
    const data = await fetchJson('/api/market-sentiment/latest');
    setMarketLatest(data?.item || null);
  }

  async function loadAnswers(ticker = answersTickerFilter) {
    const qp = new URLSearchParams();
    if (ticker) qp.set('ticker', ticker);
    const data = await fetchJson(`/api/answers${qp.toString() ? `?${qp.toString()}` : ''}`);
    setAnswers(Array.isArray(data?.items) ? data.items : []);
  }

  async function loadEvaluations() {
    const data = await fetchJson('/api/evaluations');
    setEvaluations(Array.isArray(data?.items) ? data.items : []);
  }

  async function loadHistory() {
    const data = await fetchJson('/api/history/summary');
    setHistory(Array.isArray(data?.items) ? data.items : []);
  }

  async function loadJobs() {
    const data = await fetchJson('/api/jobs');
    setJobs(Array.isArray(data?.items) ? data.items : []);
  }

  async function loadRunnerPreview(options = {}) {
    const { showLoader = true } = options;
    if (!activeGroupId) {
      setRunnerPreview({ all: null, selected: null });
      return;
    }

    if (showLoader) setRunnerPreviewLoading(true);
    try {
      setRunnerPreviewError('');
      const allParams = new URLSearchParams({
        groupId: activeGroupId,
        overwriteAnswers: String(overwriteAnswers)
      });
      const selectedParams = new URLSearchParams({
        groupId: activeGroupId,
        overwriteAnswers: String(overwriteAnswers)
      });
      const normalizedTicker = normalizeTicker(selectedTicker);
      if (normalizedTicker) selectedParams.set('ticker', normalizedTicker);

      const [allData, selectedData] = await Promise.all([
        fetchJson(`/api/analysis/preview?${allParams.toString()}`),
        normalizedTicker
          ? fetchJson(`/api/analysis/preview?${selectedParams.toString()}`)
          : Promise.resolve({ counts: null })
      ]);

      setRunnerPreview({
        all: allData?.counts || null,
        selected: selectedData?.counts || null
      });
    } catch (e) {
      setRunnerPreviewError(e instanceof Error ? e.message : 'Failed to load runner preview');
    } finally {
      if (showLoader) setRunnerPreviewLoading(false);
    }
  }

  async function loadEvaluationPreview(options = {}) {
    const { showLoader = true } = options;
    if (showLoader) setEvaluationPreviewLoading(true);
    try {
      setEvaluationPreviewError('');
      const allParams = new URLSearchParams({
        overwriteEvaluations: String(overwriteEvaluations)
      });
      const selectedParams = new URLSearchParams({
        overwriteEvaluations: String(overwriteEvaluations)
      });
      const normalizedTicker = normalizeTicker(selectedTicker);
      if (normalizedTicker) selectedParams.set('ticker', normalizedTicker);

      const [allData, selectedData] = await Promise.all([
        fetchJson(`/api/evaluations/preview?${allParams.toString()}`),
        normalizedTicker
          ? fetchJson(`/api/evaluations/preview?${selectedParams.toString()}`)
          : Promise.resolve({ counts: null })
      ]);

      setEvaluationPreview({
        all: allData?.counts || null,
        selected: selectedData?.counts || null
      });
    } catch (e) {
      setEvaluationPreviewError(e instanceof Error ? e.message : 'Failed to load evaluation preview');
    } finally {
      if (showLoader) setEvaluationPreviewLoading(false);
    }
  }

  async function bootstrap() {
    try {
      setAppError('');
      await Promise.all([
        loadTickers(),
        loadSettings(),
        loadQuestionGroups(),
        loadInstructions(),
        loadMarket(),
        loadAnswers(),
        loadEvaluations(),
        loadHistory(),
        loadJobs(),
        loadModels(provider)
      ]);
    } catch (e) {
      setAppError(e instanceof Error ? e.message : 'Failed to load app');
    }
  }

  React.useEffect(() => {
    bootstrap();
  }, []);

  React.useEffect(() => {
    if (!activeGroupId) return;
    loadQuestions(activeGroupId).catch(() => undefined);
  }, [activeGroupId]);

  React.useEffect(() => {
    loadRunnerPreview().catch(() => undefined);
  }, [activeGroupId, overwriteAnswers, selectedTicker, tickers.length, questions.length]);

  React.useEffect(() => {
    loadEvaluationPreview().catch(() => undefined);
  }, [overwriteEvaluations, selectedTicker, evaluations.length, answers.length]);

  React.useEffect(() => {
    loadSelectedCompany(selectedTicker).catch(() => undefined);
  }, [selectedTicker]);

  React.useEffect(() => {
    loadModels(provider).catch(() => undefined);
  }, [provider]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      loadJobs().catch(() => undefined);
      if (tab === 'answers') loadAnswers().catch(() => undefined);
      if (tab === 'evaluation') loadEvaluations().catch(() => undefined);
      if (tab === 'history') loadHistory().catch(() => undefined);
      if (tab === 'runner') loadRunnerPreview({ showLoader: false }).catch(() => undefined);
      if (tab === 'evaluation') loadEvaluationPreview({ showLoader: false }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [tab, answersTickerFilter]);

  async function addBulkTickers() {
    const tickersToAdd = parseBulkTickers(bulkInput);
    if (!tickersToAdd.length) return;
    setAddLoading(true);
    try {
      await fetchJson('/api/tickers/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: tickersToAdd })
      });
      setBulkInput('');
      await Promise.all([loadTickers(), loadHistory()]);
      if (!selectedTicker) setSelectedTicker(tickersToAdd[0]);
    } catch (e) {
      setAppError(e instanceof Error ? e.message : 'Failed to add tickers');
    } finally {
      setAddLoading(false);
    }
  }

  async function removeTicker(ticker) {
    await fetchJson(`/api/tickers/${encodeURIComponent(ticker)}`, { method: 'DELETE' });
    if (selectedTicker === ticker) {
      setSelectedTicker('');
      setSelectedCompany(null);
      setCompanyOverrideInput('');
      setCompanyLookupError('');
      setCompanyOverrideError('');
    }
    await Promise.all([loadTickers(), loadHistory(), loadAnswers(), loadEvaluations()]);
  }

  async function saveCompanyOverride() {
    const normalized = normalizeTicker(selectedTicker);
    if (!normalized) return;
    setCompanyOverrideSaving(true);
    try {
      setCompanyOverrideError('');
      await fetchJson('/api/company/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: normalized, name: companyOverrideInput })
      });
      await Promise.all([loadTickers(), loadSelectedCompany(normalized)]);
    } catch (e) {
      setCompanyOverrideError(e instanceof Error ? e.message : 'Failed to save company override');
    } finally {
      setCompanyOverrideSaving(false);
    }
  }

  async function saveSettings() {
    const data = await fetchJson('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsDraft)
    });
    setSettings(data?.saved || settings);
    setSettingsDraft({ xaiApiKey: '', geminiApiKey: '' });
    setSettingsMessage('Settings saved.');
    await loadModels(provider);
  }

  async function runMarketSentiment() {
    setMarketLoading(true);
    try {
      setMarketError('');
      await fetchJson('/api/market-sentiment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model })
      });
      await loadMarket();
    } catch (e) {
      setMarketError(e instanceof Error ? e.message : 'Failed to run market sentiment');
    } finally {
      setMarketLoading(false);
    }
  }

  async function createGroup() {
    if (!groupName.trim()) return;
    await fetchJson('/api/question-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName })
    });
    setGroupName('');
    await loadQuestionGroups();
  }

  async function duplicateGroup(id) {
    await fetchJson(`/api/question-groups/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
    await loadQuestionGroups();
  }

  async function activateGroup(id) {
    await fetchJson(`/api/question-groups/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    await loadQuestionGroups();
  }

  async function addQuestion() {
    if (!newQuestion.trim() || !activeGroupId) return;
    await fetchJson('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: activeGroupId, prompt: newQuestion })
    });
    setNewQuestion('');
    await loadQuestions(activeGroupId);
  }

  async function editQuestion(item) {
    const nextPrompt = window.prompt('Edit question', item.prompt);
    if (!nextPrompt || nextPrompt.trim() === item.prompt.trim()) return;
    await fetchJson(`/api/questions/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: nextPrompt })
    });
    await loadQuestions(activeGroupId);
  }

  async function removeQuestion(item) {
    const ok = window.confirm('Delete this question?');
    if (!ok) return;
    await fetchJson(`/api/questions/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    await loadQuestions(activeGroupId);
  }

  async function saveInstructions() {
    await fetchJson('/api/instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: instructions })
    });
    setInstructionsMessage('Instructions saved.');
  }

  async function startAnswerRun() {
    setJobActionLoading(true);
    try {
      await fetchJson('/api/analysis/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, groupId: activeGroupId, overwriteAnswers })
      });
      await loadJobs();
      setTab('answers');
    } finally {
      setJobActionLoading(false);
    }
  }

  async function runOneTicker() {
    const ticker = normalizeTicker(selectedTicker);
    if (!ticker) return;
    setJobActionLoading(true);
    try {
      await fetchJson('/api/analysis/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, groupId: activeGroupId, ticker, overwriteAnswers })
      });
      await loadJobs();
      setTab('answers');
    } finally {
      setJobActionLoading(false);
    }
  }

  async function pauseJob(jobId) {
    setJobActionLoading(true);
    try {
      await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}/pause`, { method: 'POST' });
      await loadJobs();
    } finally {
      setJobActionLoading(false);
    }
  }

  async function resumeJob(jobId) {
    setJobActionLoading(true);
    try {
      await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' });
      await loadJobs();
    } finally {
      setJobActionLoading(false);
    }
  }

  async function runEvaluations(ticker = '') {
    setJobActionLoading(true);
    try {
      await fetchJson('/api/evaluations/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, ticker, overwriteEvaluations })
      });
      await Promise.all([loadEvaluations(), loadHistory(), loadEvaluationPreview()]);
      setTab('evaluation');
    } finally {
      setJobActionLoading(false);
    }
  }

  async function runEvaluationForSelectedTicker() {
    const ticker = normalizeTicker(selectedTicker);
    if (!ticker) return;
    await runEvaluations(ticker);
  }

  function toggleEvaluationSort(column) {
    if (evaluationSortBy === column) {
      setEvaluationSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setEvaluationSortBy(column);
    setEvaluationSortDirection(column === 'score' || column === 'createdAt' ? 'desc' : 'asc');
  }

  async function deleteHistoryTicker(ticker) {
    await fetchJson('/api/history/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker })
    });
    await Promise.all([loadHistory(), loadTickers(), loadAnswers(), loadEvaluations()]);
  }

  const selectedTickerCard = tickers.find((item) => item.ticker === selectedTicker) || null;
  const displayCompany = selectedCompany || (selectedTickerCard ? {
    name: selectedTickerCard.companyName,
    exchange: selectedTickerCard.exchange,
    cik: selectedTickerCard.cik,
    resolvedVia: selectedTickerCard.resolvedVia,
    sources: []
  } : null);

  const filteredEvaluations = React.useMemo(() => {
    const term = evaluationSearch.trim().toUpperCase();
    return evaluations.filter((item) => {
      const matchesSearch = !term
        || String(item.ticker || '').toUpperCase().includes(term)
        || String(item.companyName || '').toUpperCase().includes(term)
        || String(item.marketAlignment || '').toUpperCase().includes(term);
      const matchesAlignment = !evaluationAlignmentFilter || item.marketAlignment === evaluationAlignmentFilter;
      return matchesSearch && matchesAlignment;
    });
  }, [evaluationAlignmentFilter, evaluationSearch, evaluations]);

  const sortedEvaluations = React.useMemo(() => {
    const factor = evaluationSortDirection === 'asc' ? 1 : -1;
    return [...filteredEvaluations].sort((left, right) => {
      const leftValue = (() => {
        if (evaluationSortBy === 'ticker') return String(left.ticker || '').toUpperCase();
        if (evaluationSortBy === 'companyName') return String(left.companyName || '').toUpperCase();
        if (evaluationSortBy === 'marketAlignment') return String(left.marketAlignment || '').toUpperCase();
        if (evaluationSortBy === 'createdAt') return new Date(left.createdAt).getTime();
        return Number(left.score || 0);
      })();
      const rightValue = (() => {
        if (evaluationSortBy === 'ticker') return String(right.ticker || '').toUpperCase();
        if (evaluationSortBy === 'companyName') return String(right.companyName || '').toUpperCase();
        if (evaluationSortBy === 'marketAlignment') return String(right.marketAlignment || '').toUpperCase();
        if (evaluationSortBy === 'createdAt') return new Date(right.createdAt).getTime();
        return Number(right.score || 0);
      })();

      if (leftValue < rightValue) return -1 * factor;
      if (leftValue > rightValue) return 1 * factor;
      return 0;
    });
  }, [evaluationSortBy, evaluationSortDirection, filteredEvaluations]);

  const selectedEvaluation = evaluations.find((item) => item.id === selectedEvaluationId) || null;

  const sortLabel = (label, column) => `${label}${evaluationSortBy === column ? ` ${evaluationSortDirection === 'asc' ? '↑' : '↓'}` : ''}`;

  function renderPreviewCard(title, counts, emptyText) {
    return (
      <Card withBorder radius="md" p="md">
        <Stack gap="xs">
          <Text fw={700}>{title}</Text>
          {!counts ? (
            <Text size="sm" c="dimmed">{emptyText}</Text>
          ) : (
            <>
              <Group gap="sm" wrap="wrap">
                <Badge color="brown">Pending {counts.pendingCount}</Badge>
                <Badge variant="light">Pairs {counts.totalPairs}</Badge>
                <Badge variant="light">Tickers {counts.tickerCount}</Badge>
                <Badge variant="light">Questions {counts.questionCount}</Badge>
              </Group>
              <Text size="sm" c="dimmed">
                Skips: {counts.skippedExisting} existing answers, {counts.skippedCompleted} already completed in the current job context.
              </Text>
            </>
          )}
        </Stack>
      </Card>
    );
  }

  function renderEvaluationPreviewCard(title, counts, emptyText) {
    return (
      <Card withBorder radius="md" p="md">
        <Stack gap="xs">
          <Text fw={700}>{title}</Text>
          {!counts ? (
            <Text size="sm" c="dimmed">{emptyText}</Text>
          ) : (
            <>
              <Group gap="sm" wrap="wrap">
                <Badge color="brown">Pending {counts.pendingCount}</Badge>
                <Badge variant="light">Eligible {counts.tickerCount}</Badge>
                <Badge variant="light">Answered {counts.availableAnswerSets}</Badge>
              </Group>
              <Text size="sm" c="dimmed">
                Skips: {counts.skippedExisting} existing evaluations.
              </Text>
            </>
          )}
        </Stack>
      </Card>
    );
  }

  return (
    <AppShell
      className="app-shell"
      navbar={{ width: 310, breakpoint: 'sm' }}
      padding="md"
      navbarOffsetBreakpoint="sm"
    >
      <AppShell.Navbar p="md" className="app-card">
        <Stack h="100%" gap="md">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Stock Research</Text>
            <Title order={2}>Market Suitability Desk</Title>
            <Text c="dimmed" size="sm">Tickers on the left. Market context, questions, answers, and ranking on the right.</Text>
          </Box>

          <TextInput
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search ticker or company"
          />

          <Paper withBorder p="xs" radius="md" bg="rgba(255,255,255,0.45)">
            <Stack gap={4}>
              {TABS.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.key}
                    active={tab === item.key}
                    onClick={() => setTab(item.key)}
                    label={item.label}
                    leftSection={<ThemeIcon variant={tab === item.key ? 'filled' : 'light'} color="brown"><Icon size={16} /></ThemeIcon>}
                  />
                );
              })}
            </Stack>
          </Paper>

          <Stack gap="xs" style={{ flex: 1, minHeight: 0 }}>
            <Group justify="space-between">
              <Text fw={700}>Ticker Search</Text>
              <Badge variant="light">{filteredTickers.length}</Badge>
            </Group>
            <ScrollArea h="100%">
              <Stack gap="xs">
                {tickersLoading ? <Loader size="sm" /> : null}
                {filteredTickers.map((item) => (
                  <Card
                    key={item.ticker}
                    withBorder
                    radius="md"
                    className="app-card"
                    p="sm"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedTicker(item.ticker)}
                  >
                    <Group justify="space-between" align="start">
                      <Stack gap={2}>
                        <Text fw={800}>{item.ticker}</Text>
                        <Text size="sm" c="dimmed">{item.companyName || 'Company unresolved'}</Text>
                      </Stack>
                      {selectedTicker === item.ticker ? <Badge color="brown">Selected</Badge> : null}
                    </Group>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Stack gap="md">
          <Paper withBorder p="md" radius="lg" className="app-card">
            <Group justify="space-between" align="start" wrap="wrap">
              <Box>
                <Text size="xs" tt="uppercase" c="dimmed" fw={700}>Current Focus</Text>
                <Group gap="sm" mt={6}>
                  <Badge size="lg" color="brown">{selectedTicker || 'No ticker selected'}</Badge>
                  {displayCompany?.name ? <Badge variant="light">{displayCompany.name}</Badge> : null}
                </Group>
              </Box>
            </Group>
            {latestJob ? (
              <Group mt="md" gap="sm" wrap="wrap">
                <Badge color={latestJob.status === 'completed' ? 'green' : latestJob.status === 'paused' ? 'yellow' : latestJob.status === 'failed' ? 'red' : 'blue'}>
                  {latestJob.type} · {latestJob.status}
                </Badge>
                {latestJob.targetTicker ? <Badge variant="light">Ticker: {latestJob.targetTicker}</Badge> : <Badge variant="light">All Tickers</Badge>}
                {latestJob.overwriteAnswers ? <Badge variant="light" color="orange">Overwrite Answers</Badge> : <Badge variant="light">Skip Existing Answers</Badge>}
                <Text size="sm" c="dimmed">{latestJob.completedCount}/{latestJob.totalCount} complete</Text>
                <Text size="sm">{latestJob.progressMessage || ''}</Text>
                {latestJob.status === 'running' ? <Button size="xs" variant="light" leftSection={<IconPlayerPause size={14} />} onClick={() => pauseJob(latestJob.id)}>Pause</Button> : null}
                {latestJob.status === 'paused' ? <Button size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />} onClick={() => resumeJob(latestJob.id)}>Resume</Button> : null}
              </Group>
            ) : null}
            {appError ? <Text mt="sm" c="red">{appError}</Text> : null}
          </Paper>

          {tab === 'tickers' ? (
            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
              <Paper withBorder p="md" radius="lg" className="app-card">
                <Stack>
                  <Box>
                    <Title order={3}>Ticker Tab</Title>
                    <Text size="sm" c="dimmed">Add or remove tickers. Bulk add accepts newline, space, tab, comma, semicolon, slash, and pipe delimiters.</Text>
                  </Box>
                  <Textarea minRows={10} value={bulkInput} onChange={(e) => setBulkInput(e.currentTarget.value)} placeholder="AAPL, MSFT, NVDA&#10;XOM TSLA" />
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">Detected: {parseBulkTickers(bulkInput).length}</Text>
                    <Button onClick={addBulkTickers} loading={addLoading}>Bulk Add</Button>
                  </Group>
                </Stack>
              </Paper>

              <Paper withBorder p="md" radius="lg" className="app-card">
                <Stack>
                  <Title order={3}>Ticker Detail</Title>
                  {!selectedTicker ? (
                    <Text c="dimmed">Select a ticker from the left panel or tracked list to inspect and override its company identity.</Text>
                  ) : (
                    <Stack gap="sm">
                      <Group justify="space-between" align="start" wrap="wrap">
                        <Box>
                          <Group gap="xs">
                            <Badge color="brown">{selectedTicker}</Badge>
                            {displayCompany?.resolvedVia ? <Badge variant="light">{displayCompany.resolvedVia}</Badge> : null}
                          </Group>
                          <Text fw={800} mt={6}>{displayCompany?.name || 'Company unresolved'}</Text>
                          <Text size="sm" c="dimmed">Exchange: {displayCompany?.exchange || 'Unknown'} · CIK: {displayCompany?.cik || 'Unknown'}</Text>
                        </Box>
                        <Group gap="sm">
                          <Button
                            color="red"
                            variant="light"
                            onClick={() => removeTicker(selectedTicker)}
                          >
                            Remove Ticker
                          </Button>
                          <Button variant="default" onClick={() => loadSelectedCompany(selectedTicker)} loading={companyLookupLoading}>Lookup company name</Button>
                        </Group>
                      </Group>
                      {companyLookupError ? <Text c="red" size="sm">{companyLookupError}</Text> : null}
                      <Group align="end" wrap="wrap">
                        <TextInput
                          label="Company name override"
                          description="Set the authoritative company name for this ticker. Clear the field and save to remove the override."
                          value={companyOverrideInput}
                          onChange={(e) => setCompanyOverrideInput(e.currentTarget.value)}
                          placeholder="e.g. Apple Inc."
                          style={{ flex: 1 }}
                        />
                        <Button onClick={saveCompanyOverride} loading={companyOverrideSaving}>Save Override</Button>
                      </Group>
                      {companyOverrideError ? <Text c="red" size="sm">{companyOverrideError}</Text> : null}
                    </Stack>
                  )}

                  <Group justify="space-between" mt="md">
                    <Title order={4}>Tracked Tickers</Title>
                    {tickersError ? <Text c="red" size="sm">{tickersError}</Text> : null}
                  </Group>
                  <ScrollArea h={420}>
                    <Table striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Ticker</Table.Th>
                          <Table.Th>Company</Table.Th>
                          <Table.Th>Resolved Via</Table.Th>
                          <Table.Th></Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {tickers.map((item) => (
                          <Table.Tr key={item.ticker} onClick={() => setSelectedTicker(item.ticker)} style={{ cursor: 'pointer' }}>
                            <Table.Td>{item.ticker}</Table.Td>
                            <Table.Td>{item.companyName || 'Unresolved'}</Table.Td>
                            <Table.Td>{item.resolvedVia || 'none'}</Table.Td>
                            <Table.Td>
                              <Button
                                size="xs"
                                variant="subtle"
                                color="red"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeTicker(item.ticker);
                                }}
                              >
                                Remove
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Stack>
              </Paper>
            </SimpleGrid>
          ) : null}

          {tab === 'market' ? (
            <Paper withBorder p="md" radius="lg" className="app-card">
              <Stack>
                <Group justify="space-between" align="start">
                  <Box>
                    <Title order={3}>Market Sentiment</Title>
                    <Text size="sm" c="dimmed">Ask the AI for current risks, opportunities, and downstream repercussions in the market. Stored in SQLite with citations.</Text>
                  </Box>
                  <Button onClick={runMarketSentiment} loading={marketLoading}>Refresh Market View</Button>
                </Group>
                {marketError ? <Text c="red">{marketError}</Text> : null}
                {!marketLatest ? <Text c="dimmed">No market sentiment run yet.</Text> : (
                  <Stack>
                    <Group gap="sm">
                      <Badge>{marketLatest.provider}</Badge>
                      <Badge variant="light">{marketLatest.model}</Badge>
                      <Text size="sm" c="dimmed">{new Date(marketLatest.createdAt).toLocaleString()}</Text>
                    </Group>
                    <Box className="rich-output" dangerouslySetInnerHTML={renderMarkdown(marketLatest.summaryMd)} />
                    {Array.isArray(marketLatest.sources) && marketLatest.sources.length ? (
                      <Stack gap={2}>
                        <Text fw={700}>Sources</Text>
                        {marketLatest.sources.map((source) => <Text key={source} size="sm">{source}</Text>)}
                      </Stack>
                    ) : null}
                  </Stack>
                )}
              </Stack>
            </Paper>
          ) : null}

          {tab === 'runner' ? (
            <Paper withBorder p="md" radius="lg" className="app-card">
              <Stack>
                <Box>
                  <Title order={3}>Runner</Title>
                  <Text size="sm" c="dimmed">Run analysis across all tracked tickers or only the selected ticker. By default, previously answered ticker/question pairs are skipped unless overwrite is enabled.</Text>
                </Box>
                <Group align="end" wrap="wrap">
                  <Select
                    label="Provider"
                    data={[{ value: 'gemini', label: 'Gemini' }, { value: 'xai', label: 'xAI' }]}
                    value={provider}
                    onChange={(value) => setProvider(value || 'gemini')}
                    w={180}
                  />
                  <Select
                    label="Model"
                    data={models.map((item) => ({ value: item, label: item }))}
                    value={model}
                    onChange={(value) => setModel(value || '')}
                    placeholder="Model"
                    searchable
                    w={320}
                  />
                </Group>
                <Checkbox
                  checked={overwriteAnswers}
                  onChange={(event) => setOverwriteAnswers(event.currentTarget.checked)}
                  label="Overwrite Answers"
                />
                {runnerPreviewError ? <Text c="red">{runnerPreviewError}</Text> : null}
                {runnerPreviewLoading ? <Loader size="sm" /> : null}
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  {renderPreviewCard('Run All Preview', runnerPreview.all, 'Preview unavailable.')}
                  {renderPreviewCard('Run One Preview', runnerPreview.selected, selectedTicker ? 'Preview unavailable.' : 'Select a ticker to preview one-ticker work.')}
                </SimpleGrid>
                <Group wrap="wrap">
                  <Button onClick={startAnswerRun} loading={jobActionLoading}>Run All Tickers</Button>
                  <Button variant="default" onClick={runOneTicker} loading={jobActionLoading} disabled={!selectedTicker}>Run One Ticker</Button>
                  <Button variant="light" onClick={() => setTab('evaluation')}>Open Evaluation</Button>
                </Group>
                <Text size="sm" c="dimmed">Selected ticker for one-ticker runs: {selectedTicker || 'None selected'}</Text>
              </Stack>
            </Paper>
          ) : null}

          {tab === 'questions' ? (
            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
              <Paper withBorder p="md" radius="lg" className="app-card">
                <Stack>
                  <Title order={3}>Question Groups</Title>
                  <Group align="end">
                    <TextInput label="New group" value={groupName} onChange={(e) => setGroupName(e.currentTarget.value)} placeholder="Current market fit" style={{ flex: 1 }} />
                    <Button onClick={createGroup}>Create</Button>
                  </Group>
                  {questionGroups.map((item) => (
                    <Card key={item.id} withBorder radius="md" p="sm">
                      <Group justify="space-between">
                        <Box>
                          <Group gap="xs">
                            <Text fw={700}>{item.name}</Text>
                            {item.isActive ? <Badge color="green">Active</Badge> : null}
                          </Group>
                          <Text size="sm" c="dimmed">{item.questionCount} questions</Text>
                        </Box>
                        <Group>
                          <Button size="xs" variant="default" onClick={() => duplicateGroup(item.id)}>Copy</Button>
                          {!item.isActive ? <Button size="xs" onClick={() => activateGroup(item.id)}>Use</Button> : null}
                        </Group>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              </Paper>

              <Paper withBorder p="md" radius="lg" className="app-card">
                <Stack>
                  <Title order={3}>Questions</Title>
                  <Group align="end">
                    <Textarea label="New question" value={newQuestion} onChange={(e) => setNewQuestion(e.currentTarget.value)} minRows={3} style={{ flex: 1 }} />
                    <Button onClick={addQuestion}>Add</Button>
                  </Group>
                  <Stack>
                    {questions.map((item) => (
                      <Card key={item.id} withBorder radius="md" p="sm">
                        <Group justify="space-between" align="start">
                          <Text style={{ flex: 1 }}>{item.prompt}</Text>
                          <Group gap="xs">
                            <Badge variant="light">w {item.weight}</Badge>
                            <Button size="xs" variant="subtle" onClick={() => editQuestion(item)}>Edit</Button>
                            <Button size="xs" variant="subtle" color="red" onClick={() => removeQuestion(item)}>Delete</Button>
                          </Group>
                        </Group>
                      </Card>
                    ))}
                  </Stack>
                </Stack>
              </Paper>
            </SimpleGrid>
          ) : null}

          {tab === 'instructions' ? (
            <Paper withBorder p="md" radius="lg" className="app-card">
              <Stack>
                <Title order={3}>Instructions</Title>
                <Text c="dimmed" size="sm">Additional AI instructions for grounding answers in public internet sources like SEC, Yahoo Finance, Benzinga, and investor relations pages.</Text>
                <Textarea minRows={18} value={instructions} onChange={(e) => setInstructions(e.currentTarget.value)} />
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">{instructionsMessage}</Text>
                  <Button onClick={saveInstructions}>Save Instructions</Button>
                </Group>
              </Stack>
            </Paper>
          ) : null}

          {tab === 'answers' ? (
            <Paper withBorder p="md" radius="lg" className="app-card">
              <Stack>
                <Group justify="space-between">
                  <Title order={3}>Answers</Title>
                  <Group>
                    <Select
                      clearable
                      searchable
                      placeholder="Filter by ticker"
                      data={tickers.map((item) => ({ value: item.ticker, label: item.ticker }))}
                      value={answersTickerFilter || null}
                      onChange={(value) => {
                        const next = value || '';
                        setAnswersTickerFilter(next);
                        loadAnswers(next).catch(() => undefined);
                      }}
                      w={220}
                    />
                    <Button variant="default" onClick={() => loadAnswers(answersTickerFilter)}>Refresh</Button>
                  </Group>
                </Group>
                <ScrollArea h={620}>
                  <Stack>
                    {answers.map((item) => (
                      <Card key={item.id} withBorder radius="md" p="md">
                        <Stack gap="xs">
                          <Group justify="space-between" align="start">
                            <Box>
                              <Group gap="xs">
                                <Badge color="brown">{item.ticker}</Badge>
                                <Badge variant="light">{item.companyName || 'Unknown company'}</Badge>
                                <Badge variant="light">{item.stance || 'unclassified'}</Badge>
                                <ScoreBadge value={item.score} />
                              </Group>
                              <Text mt={6} fw={700}>{item.questionText}</Text>
                            </Box>
                            <Text size="sm" c="dimmed">{new Date(item.createdAt).toLocaleString()}</Text>
                          </Group>
                          <Box className="rich-output" dangerouslySetInnerHTML={renderMarkdown(item.answerMd)} />
                        </Stack>
                      </Card>
                    ))}
                    {!answers.length ? <Text c="dimmed">No answers yet.</Text> : null}
                  </Stack>
                </ScrollArea>
              </Stack>
            </Paper>
          ) : null}

          {tab === 'evaluation' ? (
            <Paper withBorder p="md" radius="lg" className="app-card">
              <Stack>
                <Group justify="space-between" align="start" wrap="wrap">
                  <Box>
                    <Title order={3}>Evaluation</Title>
                    <Text size="sm" c="dimmed">Evaluate all answered tickers or only the selected ticker. Existing evaluations are skipped unless overwrite is enabled.</Text>
                  </Box>
                </Group>
                <Checkbox
                  checked={overwriteEvaluations}
                  onChange={(event) => setOverwriteEvaluations(event.currentTarget.checked)}
                  label="Overwrite Evaluations"
                />
                {evaluationPreviewError ? <Text c="red">{evaluationPreviewError}</Text> : null}
                {evaluationPreviewLoading ? <Loader size="sm" /> : null}
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  {renderEvaluationPreviewCard('Evaluate All Preview', evaluationPreview.all, 'Preview unavailable.')}
                  {renderEvaluationPreviewCard('Evaluate One Preview', evaluationPreview.selected, selectedTicker ? 'Preview unavailable.' : 'Select a ticker to preview one-stock evaluation.')}
                </SimpleGrid>
                <Group wrap="wrap">
                  <Button onClick={() => runEvaluations()} loading={jobActionLoading}>Evaluate All Tickers</Button>
                  <Button variant="default" onClick={runEvaluationForSelectedTicker} loading={jobActionLoading} disabled={!selectedTicker}>Evaluate One Ticker</Button>
                </Group>
                <Text size="sm" c="dimmed">Selected ticker for one-ticker evaluation: {selectedTicker || 'None selected'}</Text>
                <Group align="end" wrap="wrap">
                  <TextInput
                    label="Filter"
                    placeholder="Ticker, company, or alignment"
                    value={evaluationSearch}
                    onChange={(event) => setEvaluationSearch(event.currentTarget.value)}
                    w={280}
                  />
                  <Select
                    label="Alignment"
                    clearable
                    placeholder="All alignments"
                    data={[
                      { value: 'tailwind', label: 'Tailwind' },
                      { value: 'neutral', label: 'Neutral' },
                      { value: 'headwind', label: 'Headwind' }
                    ]}
                    value={evaluationAlignmentFilter || null}
                    onChange={(value) => setEvaluationAlignmentFilter(value || '')}
                    w={220}
                  />
                  <Badge variant="light">Rows {sortedEvaluations.length}</Badge>
                </Group>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        <Button variant="subtle" compact onClick={() => toggleEvaluationSort('ticker')}>{sortLabel('Ticker', 'ticker')}</Button>
                      </Table.Th>
                      <Table.Th>
                        <Button variant="subtle" compact onClick={() => toggleEvaluationSort('companyName')}>{sortLabel('Company', 'companyName')}</Button>
                      </Table.Th>
                      <Table.Th>
                        <Button variant="subtle" compact onClick={() => toggleEvaluationSort('marketAlignment')}>{sortLabel('Alignment', 'marketAlignment')}</Button>
                      </Table.Th>
                      <Table.Th>
                        <Button variant="subtle" compact onClick={() => toggleEvaluationSort('score')}>{sortLabel('Score', 'score')}</Button>
                      </Table.Th>
                      <Table.Th>
                        <Button variant="subtle" compact onClick={() => toggleEvaluationSort('createdAt')}>{sortLabel('Updated', 'createdAt')}</Button>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sortedEvaluations.map((item) => (
                      <Table.Tr key={item.id} onClick={() => setSelectedEvaluationId(item.id)} style={{ cursor: 'pointer' }}>
                        <Table.Td>{item.ticker}</Table.Td>
                        <Table.Td>{item.companyName || 'Unknown'}</Table.Td>
                        <Table.Td>{item.marketAlignment || 'neutral'}</Table.Td>
                        <Table.Td><ScoreBadge value={item.score} /></Table.Td>
                        <Table.Td>{new Date(item.createdAt).toLocaleString()}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                {selectedEvaluation ? (
                  <Card withBorder radius="md" p="md">
                    <Text fw={800}>{selectedEvaluation.ticker} · {selectedEvaluation.companyName || 'Unknown company'}</Text>
                    <Box className="rich-output" dangerouslySetInnerHTML={renderMarkdown(selectedEvaluation.summaryMd)} />
                  </Card>
                ) : null}
                {sortedEvaluations.length && !selectedEvaluation ? <Text c="dimmed">Click a company in the table to view its evaluation summary.</Text> : null}
                {!evaluations.length ? <Text c="dimmed">No evaluations yet.</Text> : null}
              </Stack>
            </Paper>
          ) : null}

          {tab === 'history' ? (
            <Paper withBorder p="md" radius="lg" className="app-card">
              <Stack>
                <Group justify="space-between">
                  <Title order={3}>History</Title>
                  <Button variant="default" onClick={loadHistory}>Refresh</Button>
                </Group>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Ticker</Table.Th>
                      <Table.Th>Company</Table.Th>
                      <Table.Th>Answers</Table.Th>
                      <Table.Th>Evaluations</Table.Th>
                      <Table.Th>Updated</Table.Th>
                      <Table.Th></Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {history.map((item) => (
                      <Table.Tr key={item.ticker}>
                        <Table.Td>{item.ticker}</Table.Td>
                        <Table.Td>{item.companyName || 'Unknown'}</Table.Td>
                        <Table.Td>{item.answerCount}</Table.Td>
                        <Table.Td>{item.evaluationCount}</Table.Td>
                        <Table.Td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}</Table.Td>
                        <Table.Td><Button size="xs" color="red" variant="subtle" onClick={() => deleteHistoryTicker(item.ticker)}>Delete</Button></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Paper>
          ) : null}

          {tab === 'settings' ? (
            <Paper withBorder p="md" radius="lg" className="app-card">
              <Stack>
                <Title order={3}>Settings</Title>
                <Text size="sm" c="dimmed">API keys are stored in SQLite on this machine, following the reference pattern.</Text>
                <SimpleGrid cols={{ base: 1, md: 2 }}>
                  <Card withBorder radius="md" p="md">
                    <Stack>
                      <Text fw={700}>Gemini</Text>
                      <Text size="sm" c="dimmed">Configured: {settings?.gemini?.configured ? settings.gemini.masked : 'No'}</Text>
                      <TextInput value={settingsDraft.geminiApiKey} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, geminiApiKey: e.currentTarget.value }))} placeholder="Paste Gemini API key" />
                    </Stack>
                  </Card>
                  <Card withBorder radius="md" p="md">
                    <Stack>
                      <Text fw={700}>xAI</Text>
                      <Text size="sm" c="dimmed">Configured: {settings?.xai?.configured ? settings.xai.masked : 'No'}</Text>
                      <TextInput value={settingsDraft.xaiApiKey} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, xaiApiKey: e.currentTarget.value }))} placeholder="Paste xAI API key" />
                    </Stack>
                  </Card>
                </SimpleGrid>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">{settingsMessage}</Text>
                  <Button onClick={saveSettings}>Save Settings</Button>
                </Group>
              </Stack>
            </Paper>
          ) : null}
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}