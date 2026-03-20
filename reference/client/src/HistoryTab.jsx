import React from 'react';
import { ActionIcon, Badge, Button, Checkbox, Group, Paper, Stack, Text, TextInput, Tooltip } from '@mantine/core';

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
  return data;
}

function formatDateTime(iso) {
  if (typeof iso !== 'string' || !iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function tabLabel(tabKey) {
  if (tabKey === 'runway') return 'Runway';
  if (tabKey === 'news') return 'News';
  if (tabKey === 'analysts') return 'Analysts';
  if (tabKey === 'dilution') return 'Dilution';
  if (tabKey === 'adhoc') return 'Ad-hoc';
  if (tabKey === 'value') return 'Value';
  if (tabKey === 'catout') return 'Cat out of bag';
  if (tabKey === 'research') return 'Research';
  return tabKey;
}

export default function HistoryTab({ onDeletedTicker }) {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [filter, setFilter] = React.useState('');
  const [tickerToDelete, setTickerToDelete] = React.useState('');
  const [selectedByTicker, setSelectedByTicker] = React.useState({});

  async function load() {
    setLoading(true);
    try {
      setError('');
      setInfo('');
      const data = await fetchJson('/api/history/summary');
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setItems(nextItems);
      setSelectedByTicker((prev) => {
        const deletable = new Set(nextItems.filter((it) => !it?.favorite).map((it) => String(it?.ticker || '').toUpperCase()));
        const next = {};
        for (const [k, v] of Object.entries(prev || {})) {
          const t = String(k || '').toUpperCase();
          if (v && deletable.has(t)) next[t] = true;
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function deleteTicker(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;

    const local = items.find((it) => String(it?.ticker || '').toUpperCase() === t);
    if (local?.favorite) {
      setError('Cannot delete a favourite. Unfavourite it first.');
      return;
    }

    const ok = window.confirm(`Delete ALL stored history for ${t}? This cannot be undone.`);
    if (!ok) return;

    try {
      setError('');
      setInfo('');
      await fetchJson('/api/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t })
      });
      if (typeof onDeletedTicker === 'function') onDeletedTicker(t);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  async function deleteSelected() {
    const tickers = Object.entries(selectedByTicker || {})
      .filter(([, v]) => Boolean(v))
      .map(([t]) => String(t).toUpperCase())
      .filter(Boolean);
    if (!tickers.length) return;

    const ok = window.confirm(`Delete stored history for ${tickers.length} ticker(s)? This cannot be undone.`);
    if (!ok) return;

    try {
      setError('');
      setInfo('');
      const resp = await fetchJson('/api/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers })
      });

      const deleted = Array.isArray(resp?.tickersDeleted) ? resp.tickersDeleted : [];
      for (const t of deleted) {
        if (typeof onDeletedTicker === 'function') onDeletedTicker(String(t).toUpperCase());
      }

      const skipped = Array.isArray(resp?.favoritesSkipped) ? resp.favoritesSkipped : [];
      const deletedCount = deleted.length;
      const skippedCount = skipped.length;
      if (skippedCount) {
        setInfo(`Deleted ${deletedCount} ticker(s). Skipped ${skippedCount} favourite(s).`);
      } else {
        setInfo(`Deleted ${deletedCount} ticker(s).`);
      }

      setSelectedByTicker({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete selected');
    }
  }

  async function setFavorite(ticker, nextFavorite) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return;
    try {
      setError('');
      setInfo('');
      await fetchJson('/api/history/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t, favorite: Boolean(nextFavorite) })
      });
      setItems((prev) =>
        (Array.isArray(prev) ? prev : []).map((it) =>
          String(it?.ticker || '').toUpperCase() === t ? { ...it, favorite: Boolean(nextFavorite) } : it
        )
      );
      if (nextFavorite) {
        setSelectedByTicker((prev) => {
          const next = { ...(prev || {}) };
          delete next[t];
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update favourite');
    }
  }

  const normalizedFilter = String(filter || '').trim().toUpperCase();
  const filtered = React.useMemo(() => {
    if (!normalizedFilter) return items;
    return items.filter((it) => String(it?.ticker || '').toUpperCase().includes(normalizedFilter));
  }, [items, normalizedFilter]);

  const visibleDeletableTickers = React.useMemo(() => {
    return filtered
      .filter((it) => !it?.favorite)
      .map((it) => String(it?.ticker || '').toUpperCase())
      .filter(Boolean);
  }, [filtered]);

  const selectedTickers = React.useMemo(() => {
    return Object.entries(selectedByTicker || {})
      .filter(([, v]) => Boolean(v))
      .map(([t]) => String(t).toUpperCase())
      .filter(Boolean);
  }, [selectedByTicker]);

  const allVisibleSelected =
    visibleDeletableTickers.length > 0 && visibleDeletableTickers.every((t) => Boolean(selectedByTicker?.[t]));

  function toggleSelectAllVisible() {
    if (!visibleDeletableTickers.length) return;
    setSelectedByTicker((prev) => {
      const next = { ...(prev || {}) };
      if (allVisibleSelected) {
        for (const t of visibleDeletableTickers) delete next[t];
      } else {
        for (const t of visibleDeletableTickers) next[t] = true;
      }
      return next;
    });
  }

  const tabsForItem = (it) => {
    const tabs = it?.tabs && typeof it.tabs === 'object' ? Object.keys(it.tabs) : [];
    return tabs.sort((a, b) => a.localeCompare(b));
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <div>
          <Text fw={700} size="lg">
            History
          </Text>
          <Text c="dimmed" size="sm">
            Stored indefinitely. Delete a ticker to remove it from all tabs.
          </Text>
        </div>
        <Button variant="default" onClick={load} loading={loading}>
          Refresh
        </Button>
      </Group>

      {error ? (
        <Text c="red" size="sm">
          {error}
        </Text>
      ) : null}

      {info ? (
        <Text c="dimmed" size="sm">
          {info}
        </Text>
      ) : null}

      <Group align="end" wrap="wrap">
        <TextInput
          label="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="AAPL"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: '1 1 240px' }}
        />
        <TextInput
          label="Delete ticker"
          value={tickerToDelete}
          onChange={(e) => setTickerToDelete(e.target.value)}
          placeholder="Type ticker to delete"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: '1 1 240px' }}
        />
        <Button color="red" onClick={() => deleteTicker(tickerToDelete)} disabled={!String(tickerToDelete || '').trim()}>
          Delete
        </Button>

        <Button
          variant="default"
          onClick={toggleSelectAllVisible}
          disabled={!visibleDeletableTickers.length}
          title="Select/deselect all visible non-favourites"
        >
          {allVisibleSelected ? 'Deselect all' : 'Select all'}
        </Button>
        <Button color="red" onClick={deleteSelected} disabled={!selectedTickers.length}>
          Delete selected ({selectedTickers.length})
        </Button>
      </Group>

      <Paper withBorder p="md" radius="md">
        {!filtered.length ? (
          <Text c="dimmed">No saved history.</Text>
        ) : (
          <Stack gap="sm">
            {filtered.slice(0, 1000).map((it) => (
              <Group key={it.ticker} justify="space-between" align="flex-start" wrap="wrap">
                <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 260 }}>
                  <Tooltip
                    label={it?.favorite ? 'Favourites cannot be deleted' : 'Select for deletion'}
                    disabled={!it?.favorite}
                  >
                    <div>
                      <Checkbox
                        checked={Boolean(selectedByTicker?.[String(it?.ticker || '').toUpperCase()])}
                        disabled={Boolean(it?.favorite)}
                        onChange={(e) => {
                          const t = String(it?.ticker || '').toUpperCase();
                          const checked = Boolean(e?.currentTarget?.checked);
                          setSelectedByTicker((prev) => {
                            const next = { ...(prev || {}) };
                            if (checked) next[t] = true;
                            else delete next[t];
                            return next;
                          });
                        }}
                        aria-label={`Select ${it.ticker}`}
                      />
                    </div>
                  </Tooltip>

                  <div>
                    <Group gap={6} wrap="nowrap">
                      <Text fw={800}>{it.ticker}</Text>
                      <Tooltip label={it?.favorite ? 'Unfavourite' : 'Mark as favourite'}>
                        <ActionIcon
                          variant="subtle"
                          onClick={() => setFavorite(it.ticker, !it?.favorite)}
                          aria-label={it?.favorite ? `Unfavourite ${it.ticker}` : `Favourite ${it.ticker}`}
                        >
                          <Text fw={800}>{it?.favorite ? '★' : '☆'}</Text>
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  <Text c="dimmed" size="xs">
                    Last updated: {formatDateTime(it.updatedAt)}
                  </Text>
                  </div>
                </Group>

                <Group gap={6} wrap="wrap" style={{ flex: '1 1 360px' }}>
                  {tabsForItem(it).map((t) => (
                    <Badge key={t} variant="light" title={formatDateTime(it?.tabs?.[t])}>
                      {tabLabel(t)}
                    </Badge>
                  ))}
                </Group>

                <Button
                  color="red"
                  variant="light"
                  size="xs"
                  onClick={() => deleteTicker(it.ticker)}
                  disabled={Boolean(it?.favorite)}
                  title={it?.favorite ? 'Favourites cannot be deleted' : 'Delete this ticker'}
                >
                  Delete
                </Button>
              </Group>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
