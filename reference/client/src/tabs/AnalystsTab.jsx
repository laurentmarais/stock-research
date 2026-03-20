import React from 'react';
import { Box, Paper, Stack, Text } from '@mantine/core';
import BucketGrid from '../shared/BucketGrid.jsx';
import { formatConsensusTargets, formatDateTime, formatPriceTarget, sortByPublishedAtDesc } from '../shared/format.js';

export default function AnalystsTab({ analysts, hasAnalystsResult }) {
  return (
    <Stack gap="md" mt="md">
      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Analyst sentiment (percent positive)</Text>
        <Box mt={8}>
          <BucketGrid buckets={analysts?.sentiment} mode="pct" />
        </Box>
      </Paper>

      {hasAnalystsResult && analysts?.consensusPriceTargets ? (
        <Paper withBorder p="md" radius="md">
          <Text fw={700}>Consensus price targets</Text>
          <Text mt={6}>{formatConsensusTargets(analysts.consensusPriceTargets)}</Text>
        </Paper>
      ) : null}

      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Recent analyst items</Text>
        {!hasAnalystsResult || !analysts?.items?.length ? (
          <Text c="dimmed">—</Text>
        ) : (
          <Stack gap={6} mt={6}>
            {sortByPublishedAtDesc(analysts.items).map((it) => (
              <div key={it.url}>
                <Text size="xs" c="dimmed">
                  {formatDateTime(it.publishedAt)}
                </Text>
                <Text size="sm">
                  <strong>{it.sentiment}</strong>{' '}
                  {it.action && it.action !== 'none' ? <span className="muted">[{it.action}] </span> : null}
                  {it.firm ? <span className="muted">{it.firm} </span> : null}
                  {formatPriceTarget({ fromUsd: it.priceTargetFromUsd, toUsd: it.priceTargetToUsd }) ? (
                    <span className="muted">{formatPriceTarget({ fromUsd: it.priceTargetFromUsd, toUsd: it.priceTargetToUsd })} </span>
                  ) : null}
                  <a href={it.url} target="_blank" rel="noreferrer">
                    {it.title}
                  </a>
                  {it.note ? <span className="muted"> — {it.note}</span> : null}
                </Text>
              </div>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
