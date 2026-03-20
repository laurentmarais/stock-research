import React from 'react';
import { Badge, Box, Paper, Stack, Text } from '@mantine/core';
import BucketGrid from '../shared/BucketGrid.jsx';
import { formatDateTime, sortByPublishedAtDesc } from '../shared/format.js';
import { sentimentToBadge } from '../shared/sentiment.js';

export default function NewsTab({ news, hasNewsResult }) {
  return (
    <Stack gap="md" mt="md">
      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Split / dilution in next month</Text>
        {!hasNewsResult ? (
          <Text c="dimmed">—</Text>
        ) : !news?.splitDilutionNextMonth?.length ? (
          <Text c="dimmed">None detected</Text>
        ) : (
          <Stack gap={6} mt={6}>
            {sortByPublishedAtDesc(news.splitDilutionNextMonth).map((it) => (
              <div key={it.url}>
                <Text size="xs" c="dimmed">
                  {formatDateTime(it.publishedAt)}
                </Text>
                <Text size="sm">
                  <strong>{it.corporateAction}</strong>: {
                    ' '
                  }
                  <a href={it.url} target="_blank" rel="noreferrer">
                    {it.headline}
                  </a>
                  {it.note ? <span className="muted"> — {it.note}</span> : null}
                </Text>
              </div>
            ))}
          </Stack>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Text fw={700}>News positivity (percent positive)</Text>
        <Box mt={8}>
          <BucketGrid buckets={news?.positivity} mode="pct" />
        </Box>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Recent articles</Text>
        {!hasNewsResult || !news?.articles?.length ? (
          <Text c="dimmed">—</Text>
        ) : (
          <Stack gap={6} mt={6}>
            {sortByPublishedAtDesc(news.articles).map((a) => (
              <div key={a.url}>
                <Text size="xs" c="dimmed">
                  {formatDateTime(a.publishedAt)}
                </Text>
                <Text size="sm">
                  {(() => {
                    const b = sentimentToBadge(a.sentiment);
                    return (
                      <>
                        <Badge size="xs" variant="light" color={b.color} styles={{ label: { color: b.textColor } }} mr={6}>
                          {b.label}
                        </Badge>
                        <a href={a.url} target="_blank" rel="noreferrer">
                          {a.title}
                        </a>
                      </>
                    );
                  })()}
                </Text>
              </div>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
