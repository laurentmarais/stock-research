import React from 'react';
import { Badge, Box, Button, Group, Paper, Select, Stack, Text, Textarea, TypographyStylesProvider } from '@mantine/core';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

function normalizeTicker(ticker) {
  return typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
}

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `Request failed (${resp.status})`);
  }
  return data;
}

function formatLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function renderMarkdown(md) {
  const src = typeof md === 'string' ? md : '';
  const html = marked.parse(src, { breaks: true, gfm: true });
  return DOMPurify.sanitize(html);
}

export default function ResearchTab({ ticker, onTickerChange }) {
  const t = normalizeTicker(ticker);
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const [tickerOptions, setTickerOptions] = React.useState([]);
  const [tickersLoading, setTickersLoading] = React.useState(false);
  const [tickersError, setTickersError] = React.useState('');

  const [editingId, setEditingId] = React.useState(null); // null => adding
  const [draft, setDraft] = React.useState('');
  const [isEditing, setIsEditing] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setTickersError('');
    setTickersLoading(true);

    async function loadTickers() {
      try {
        const [history, research] = await Promise.all([
          fetchJson('/api/history/summary?limit=5000', { signal: controller.signal }).catch(() => ({ items: [] })),
          fetchJson('/api/research/tickers?limit=5000', { signal: controller.signal }).catch(() => ({ tickers: [] }))
        ]);
        if (cancelled) return;

        const set = new Set();
        const hist = Array.isArray(history?.items) ? history.items : [];
        for (const it of hist) {
          const tk = normalizeTicker(it?.ticker || '');
          if (tk) set.add(tk);
        }
        const rs = Array.isArray(research?.tickers) ? research.tickers : [];
        for (const tk of rs) {
          const nt = normalizeTicker(tk);
          if (nt) set.add(nt);
        }

        const list = [...set].sort((a, b) => a.localeCompare(b));
        setTickerOptions(list.map((x) => ({ value: x, label: x })));
      } catch (e) {
        if (cancelled) return;
        setTickersError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setTickersLoading(false);
      }
    }

    loadTickers();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const sorted = React.useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    return [...list].sort((a, b) => {
      const ta = a?.updatedAt || a?.createdAt || '';
      const tb = b?.updatedAt || b?.createdAt || '';
      return tb.localeCompare(ta);
    });
  }, [items]);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setError('');
    setItems([]);
    setIsEditing(false);
    setEditingId(null);
    setDraft('');

    if (!t) return () => {};

    async function load() {
      setLoading(true);
      try {
        const qp = new URLSearchParams({ ticker: t });
        const data = await fetchJson(`/api/research?${qp.toString()}`, { signal: controller.signal });
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [t]);

  function startAdd() {
    setError('');
    if (!t) {
      setError('Set a ticker first.');
      return;
    }
    setIsEditing(true);
    setEditingId(null);
    setDraft('');
  }

  function startEdit(id) {
    setError('');
    const it = items.find((x) => x.id === id);
    if (!it) return;
    setIsEditing(true);
    setEditingId(id);
    setDraft(it.md || '');
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditingId(null);
    setDraft('');
  }

  function save() {
    (async () => {
      setError('');
      if (!t) {
        setError('Set a ticker first.');
        return;
      }
      const md = String(draft || '').trimEnd();
      if (!md.trim()) {
        setError('Research text is required.');
        return;
      }

      setLoading(true);
      try {
        if (!editingId) {
          const data = await fetchJson('/api/research', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: t, md })
          });
          const item = data?.item;
          if (item && typeof item === 'object') {
            setItems((prev) => [item, ...(Array.isArray(prev) ? prev : [])]);
            setTickerOptions((prev) => {
              const list = Array.isArray(prev) ? prev : [];
              if (list.some((o) => o?.value === t)) return list;
              const next = [...list, { value: t, label: t }];
              next.sort((a, b) => String(a.value).localeCompare(String(b.value)));
              return next;
            });
          } else {
            const qp = new URLSearchParams({ ticker: t });
            const refreshed = await fetchJson(`/api/research?${qp.toString()}`);
            setItems(Array.isArray(refreshed?.items) ? refreshed.items : []);
          }
          cancelEdit();
          return;
        }

        const data = await fetchJson(`/api/research/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: t, md })
        });
        const item = data?.item;
        if (item && typeof item === 'object') {
          setItems((prev) => (Array.isArray(prev) ? prev.map((it) => (it.id === editingId ? item : it)) : [item]));
        }
        cancelEdit();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }

  function remove(id) {
    (async () => {
      setError('');
      if (!t) return;
      const it = items.find((x) => x.id === id);
      if (!it) return;
      const ok = window.confirm('Delete this research item?');
      if (!ok) return;

      setLoading(true);
      try {
        const qp = new URLSearchParams({ ticker: t });
        await fetchJson(`/api/research/${encodeURIComponent(id)}?${qp.toString()}`, { method: 'DELETE' });
        setItems((prev) => (Array.isArray(prev) ? prev.filter((x) => x.id !== id) : []));
        if (editingId === id) cancelEdit();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }

  return (
    <Stack gap="md">
      <div>
        <Text fw={600} size="lg">
          Research
        </Text>
        <Text c="dimmed" size="sm">
          Manual markdown notes stored in SQLite (per ticker).
        </Text>
      </div>

      <Group gap="sm" wrap="wrap" align="end">
        <Select
          label="Ticker"
          placeholder={tickersLoading ? '(loading…)'
            : tickersError
              ? '(tickers failed to load)'
              : 'Pick a ticker…'}
          searchable
          clearable
          data={tickerOptions}
          value={t || null}
          onChange={(value) => {
            const next = normalizeTicker(value || '');
            onTickerChange?.(next);
          }}
          style={{ flex: '1 1 260px' }}
        />
        <Badge variant="light" size="lg" color={t ? undefined : 'gray'}>
          {t || '—'}
        </Badge>
        <Button type="button" variant="default" onClick={startAdd} disabled={!t || isEditing || loading}>
          Add research
        </Button>
      </Group>

      {tickersError ? (
        <Text c="red" size="sm">
          {tickersError}
        </Text>
      ) : null}

      {error ? (
        <Text c="red" size="sm">
          {error}
        </Text>
      ) : null}

      {isEditing ? (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Text fw={600} size="sm">
              {editingId ? 'Edit research item' : 'New research item'}
            </Text>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              autosize
              minRows={6}
              placeholder="Write markdown…"
            />
            <Group gap="sm" wrap="wrap">
              <Button type="button" onClick={save} loading={loading}>
                Save
              </Button>
              <Button type="button" variant="default" onClick={cancelEdit} disabled={loading}>
                Cancel
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : null}

      {!t ? (
        <Text c="dimmed" size="sm">
          Set a ticker in the sidebar to view/add research.
        </Text>
      ) : loading && sorted.length === 0 ? (
        <Text c="dimmed" size="sm">
          Loading research…
        </Text>
      ) : sorted.length === 0 ? (
        <Text c="dimmed" size="sm">
          No research items yet.
        </Text>
      ) : (
        <Stack gap="sm">
          {sorted.map((it) => {
            const stamp = it.updatedAt || it.createdAt;
            const stampText = formatLocal(stamp);
            const html = renderMarkdown(it.md || '');

            return (
              <Paper key={it.id} withBorder p="md" radius="md">
                <Stack gap="xs">
                  <Group justify="space-between" wrap="wrap" align="center">
                    <Text c="dimmed" size="xs">
                      {stampText ? `Updated ${stampText}` : '—'}
                    </Text>
                    <Group gap="xs" wrap="wrap">
                      <Button size="xs" variant="default" onClick={() => startEdit(it.id)} disabled={isEditing}>
                        Edit
                      </Button>
                      <Button size="xs" variant="default" color="red" onClick={() => remove(it.id)} disabled={isEditing || loading}>
                        Delete
                      </Button>
                    </Group>
                  </Group>

                  <Box>
                    <TypographyStylesProvider>
                      <div dangerouslySetInnerHTML={{ __html: html }} />
                    </TypographyStylesProvider>
                  </Box>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
