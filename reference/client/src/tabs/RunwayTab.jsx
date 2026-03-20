import React from 'react';
import { Group, Paper, Stack, Text } from '@mantine/core';
import { formatMonths, formatUsd } from '../shared/format.js';

export default function RunwayTab({ runway, hasRunwayResult }) {
  return (
    <Stack gap="md" mt="md">
      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Cash runway</Text>
        {(() => {
          const months = runway?.accurate?.runwayMonths ?? runway?.estimate?.runwayMonths;
          const isLow = typeof months === 'number' && Number.isFinite(months) && months < 2;
          return (
            <Text size="lg" fw={900} c={isLow ? 'red' : undefined}>
              {!hasRunwayResult
                ? '—'
                : runway?.accurate?.runwayMonths === null && runway?.estimate?.runwayMonths === null
                  ? 'Insufficient data'
                  : formatMonths(runway?.accurate?.runwayMonths ?? runway?.estimate?.runwayMonths)}
            </Text>
          );
        })()}
      </Paper>

      <Group gap="md" align="stretch" wrap="wrap">
        <Paper withBorder p="md" radius="md" style={{ flex: '1 1 320px' }}>
          <Text fw={700}>Accurate (sourced)</Text>
          <Text size="sm">Cash on hand: {formatUsd(runway?.accurate?.cashOnHandUsd)}</Text>
          <Text size="sm">Burn rate / month: {formatUsd(runway?.accurate?.burnRateUsdPerMonth)}</Text>
          <Text size="sm">Runway: {formatMonths(runway?.accurate?.runwayMonths)}</Text>
        </Paper>
        <Paper withBorder p="md" radius="md" style={{ flex: '1 1 320px' }}>
          <Text fw={700}>Best estimate</Text>
          <Text size="sm">Cash on hand: {formatUsd(runway?.estimate?.cashOnHandUsd)}</Text>
          <Text size="sm">Burn rate / month: {formatUsd(runway?.estimate?.burnRateUsdPerMonth)}</Text>
          <Text size="sm">Runway: {formatMonths(runway?.estimate?.runwayMonths)}</Text>
        </Paper>
      </Group>

      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Sources</Text>
        {!hasRunwayResult || !runway?.sources?.length ? (
          <Text c="dimmed">—</Text>
        ) : (
          <Stack gap={4} mt={6}>
            {runway.sources.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                {u}
              </a>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
