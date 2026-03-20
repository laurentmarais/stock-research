import React from 'react';
import { Paper, Stack, Text } from '@mantine/core';

export default function AdhocTab({ hasAdhocResult, adhocAnswerText }) {
  return (
    <Stack gap="md" mt="md">
      <Paper withBorder p="md" radius="md">
        <Text fw={700}>Answer</Text>
        <Text style={{ whiteSpace: 'pre-wrap' }} mt={6}>
          {hasAdhocResult ? adhocAnswerText || '—' : '—'}
        </Text>
      </Paper>
    </Stack>
  );
}
