import React from 'react';
import { Group, Paper, Text } from '@mantine/core';
import { formatPct } from './format.js';

export default function BucketGrid({ buckets, mode }) {
  if (!buckets) return <Text c="dimmed">—</Text>;
  const keys = ['1h', '24h', 'week', 'month'];
  return (
    <Group gap="sm" wrap="wrap">
      {keys.map((k) => {
        const b = buckets[k];
        if (!b) return null;
        return (
          <Paper key={k} withBorder p="sm" radius="md" style={{ minWidth: 180 }}>
            <Text fw={700} size="sm">
              {k}
            </Text>
            {mode === 'pct' ? (
              <>
                <Text size="lg" fw={800}>
                  {formatPct(b.positivePct)}
                </Text>
                <Text c="dimmed" size="xs">
                  {b.positive} pos / {b.negative} neg / {b.neutral} neu ({b.total})
                </Text>
              </>
            ) : (
              <>
                <Text size="lg" fw={800}>
                  {b.positive} / {b.negative}
                </Text>
                <Text c="dimmed" size="xs">
                  pos / neg (neu {b.neutral}, total {b.total})
                </Text>
              </>
            )}
          </Paper>
        );
      })}
    </Group>
  );
}
