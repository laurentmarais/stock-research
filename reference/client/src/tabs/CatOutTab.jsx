import React from 'react';
import { Box, Paper, Stack, Text } from '@mantine/core';
import LinkifiedPre from '../shared/LinkifiedPre.jsx';

export default function CatOutTab({ hasCatOutResult, catOutReportText }) {
  return (
    <Stack gap="md" mt="md">
      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Cat out of bag report</Text>
        <Box mt={6}>{hasCatOutResult ? <LinkifiedPre text={catOutReportText || '—'} /> : <Text c="dimmed">—</Text>}</Box>
      </Paper>
    </Stack>
  );
}
