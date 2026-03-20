import React from 'react';
import { Box, Group, Paper, Stack, Text } from '@mantine/core';
import LinkifiedPre from '../shared/LinkifiedPre.jsx';

function fmtUsd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const digits = n >= 100 ? 0 : 2;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

export default function ValueTab({ hasValueResult, valueReportText, estimates }) {
  const e = estimates && typeof estimates === 'object' ? estimates : null;
  const hasAnyEstimate = Boolean(
    typeof e?.pointEstimatePerShareUsd === 'number' ||
      typeof e?.bearCasePerShareUsd === 'number' ||
      typeof e?.baseCasePerShareUsd === 'number' ||
      typeof e?.bullCasePerShareUsd === 'number'
  );

  return (
    <Stack gap="md" mt="md">
      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Estimated values (per share)</Text>
        <Text c="dimmed" size="xs" mt={2}>
          From the AI JSON summary (per-share prices only).
        </Text>
        {!hasValueResult ? (
          <Text c="dimmed" size="sm" mt={6}>
            —
          </Text>
        ) : hasAnyEstimate ? (
          <Group gap="md" wrap="wrap" mt={6}>
            {typeof e?.pointEstimatePerShareUsd === 'number' ? (
              <Text size="sm">
                <strong>Point:</strong> {fmtUsd(e.pointEstimatePerShareUsd)}
              </Text>
            ) : null}
            {typeof e?.bearCasePerShareUsd === 'number' ? (
              <Text size="sm">
                <strong>Bear:</strong> {fmtUsd(e.bearCasePerShareUsd)}
              </Text>
            ) : null}
            {typeof e?.baseCasePerShareUsd === 'number' ? (
              <Text size="sm">
                <strong>Base:</strong> {fmtUsd(e.baseCasePerShareUsd)}
              </Text>
            ) : null}
            {typeof e?.bullCasePerShareUsd === 'number' ? (
              <Text size="sm">
                <strong>Bull:</strong> {fmtUsd(e.bullCasePerShareUsd)}
              </Text>
            ) : null}
          </Group>
        ) : (
          <Text c="dimmed" size="sm" mt={6}>
            No per-share estimates found in the JSON summary yet.
          </Text>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Value report</Text>
        <Box mt={6}>{hasValueResult ? <LinkifiedPre text={valueReportText || '—'} /> : <Text c="dimmed">—</Text>}</Box>
      </Paper>
    </Stack>
  );
}
