import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { theme, borderStyle, app } from '../theme.js';

interface AuthenticatingPageProps {
  status: 'opening' | 'detecting' | 'waiting' | 'extracting' | 'closing';
  onCancel: () => void;
}

const statusMessages = {
  opening: 'Opening browser...',
  detecting: 'Detecting authentication status...',
  waiting: 'Waiting for login...',
  extracting: 'Extracting credentials...',
  closing: 'Closing browser...',
} as const;

export function AuthenticatingPage({ status, onCancel }: AuthenticatingPageProps) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
    if (key.escape) {
      onCancel();
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
      {/* Main container with border */}
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle={borderStyle}
        borderColor={theme.primary}
        paddingX={4}
        paddingY={2}
        width={44}
      >
        {/* Title */}
        <Box marginBottom={1}>
          <Text color={theme.primary} bold>
            {app.name}
          </Text>
        </Box>
 
        {/* Auth icon */}
        <Box marginBottom={2}>
          <Text color={theme.accent}>Authenticating</Text>
        </Box>
 
        {/* Spinner with status */}
        <Box marginBottom={2}>
          <Text color={theme.info}>
            <Spinner type="dots" />
          </Text>
          <Text color={theme.text}> {statusMessages[status]}</Text>
        </Box>
 
        {/* Browser hint */}
        <Box marginBottom={1}>
          <Text color={theme.textMuted}>
            {status === 'waiting' ? 'Complete login in your browser' : 
             status === 'detecting' ? 'Checking authentication...' :
             'Please wait...'}
          </Text>
        </Box>
 
        {/* Cancel hint */}
        <Box>
          <Text color={theme.textDim}>
            Press <Text color={theme.textMuted}>Esc</Text> to cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
