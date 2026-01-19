import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme, borderStyle, app } from '../theme.js';

interface ErrorPageProps {
  title: string;
  message: string;
  onRetry: () => void;
  onBack: () => void;
}

export function ErrorPage({ title, message, onRetry, onBack }: ErrorPageProps) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
    if (input === 'r') {
      onRetry();
    }
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
      padding={1}
    >
      {/* Main container with error border */}
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle={borderStyle}
        borderColor={theme.error}
        paddingX={4}
        paddingY={2}
        width={50}
      >
        {/* Title */}
        <Box marginBottom={1}>
          <Text color={theme.primary} bold>
            {app.name}
          </Text>
        </Box>

        {/* Error icon and title */}
        <Box marginBottom={1}>
          <Text color={theme.error} bold>
            {title}
          </Text>
        </Box>

        {/* Error message */}
        <Box marginBottom={2} paddingX={2}>
          <Text color={theme.textMuted} wrap="wrap">
            {message}
          </Text>
        </Box>

        {/* Actions */}
        <Box flexDirection="column" alignItems="center" gap={0}>
          <Text color={theme.textDim}>
            Press <Text color={theme.primary}>'r'</Text> to retry
          </Text>
          <Text color={theme.textDim}>
            Press <Text color={theme.textMuted}>Esc</Text> to go back
          </Text>
          <Text color={theme.textDim}>
            Press <Text color={theme.textMuted}>'q'</Text> to quit
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
