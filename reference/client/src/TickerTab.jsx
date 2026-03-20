import React from 'react';
import { Badge, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';

export default function TickerTab({
  ticker,
  onTickerChange,
  recentTickers,
  company,
  companyByTicker,
  lookupLoading,
  lookupError,
  onLookupCompany,
  overrideName,
  onOverrideNameChange,
  overrideSaving,
  overrideError,
  onSaveOverride
}) {
  const normalized = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  const companyName = typeof company?.name === 'string' ? company.name.trim() : '';
  const companyVia = typeof company?.resolvedVia === 'string' ? company.resolvedVia.trim() : '';

  return (
    <Stack gap="md">
      <div>
        <Text fw={600} size="lg">
          Ticker
        </Text>
        <Text c="dimmed" size="sm">
          Shared across all tabs.
        </Text>
      </div>

      <Group align="end" gap="sm" wrap="wrap">
        {normalized ? (
          <Badge variant="light" size="lg">
            {normalized}
          </Badge>
        ) : (
          <Badge variant="light" color="gray" size="lg">
            —
          </Badge>
        )}
      </Group>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap">
            <div>
              <Text fw={600} size="sm">
                Company
              </Text>
              <Text fw={900} size="lg">
                {companyName || (normalized ? 'Company not resolved' : '—')}
              </Text>
              <Group gap="xs" wrap="wrap" mt={4}>
                {normalized ? <Badge variant="light">{normalized}</Badge> : null}
                {companyVia ? <Badge variant="light">{companyVia}</Badge> : null}
              </Group>
            </div>
            <Group gap="sm" wrap="wrap">
              <Button
                type="button"
                variant="default"
                disabled={!normalized}
                loading={Boolean(lookupLoading)}
                onClick={() => onLookupCompany?.(normalized)}
              >
                Lookup company name
              </Button>
              <Button
                type="button"
                variant="default"
                disabled={!normalized}
                onClick={() => {
                  onTickerChange?.(normalized);
                  onLookupCompany?.(normalized);
                }}
              >
                Load history
              </Button>
            </Group>
          </Group>

          {lookupError ? (
            <Text c="red" size="sm">
              {lookupError}
            </Text>
          ) : null}

          <Group gap="sm" wrap="wrap" align="end">
            <TextInput
              label="Company name (if incorrect)"
              description="Type the correct company name, then Save Override to apply everywhere."
              value={overrideName}
              onChange={(e) => onOverrideNameChange?.(e.currentTarget.value)}
              placeholder="e.g. IP Strategy Holdings"
              style={{ flex: '1 1 420px' }}
            />
            <Button type="button" variant="default" disabled={!normalized} loading={Boolean(overrideSaving)} onClick={onSaveOverride}>
              Save Override
            </Button>
          </Group>

          {overrideError ? (
            <Text c="red" size="sm">
              {overrideError}
            </Text>
          ) : null}
        </Stack>
      </Paper>

      <div>
        <Text fw={600} size="sm" mb={6}>
          Recent
        </Text>
        {!Array.isArray(recentTickers) || !recentTickers.length ? (
          <Text c="dimmed" size="sm">
            No recent tickers yet.
          </Text>
        ) : (
          <Group gap="xs" wrap="wrap">
            {recentTickers.slice(0, 40).map((t) => (
              <Button
                key={t}
                variant="light"
                size="xs"
                onClick={() => {
                  onTickerChange?.(t);
                  onLookupCompany?.(t);
                }}
              >
                {t}
              </Button>
            ))}
          </Group>
        )}
      </div>
    </Stack>
  );
}
