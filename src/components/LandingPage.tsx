import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme, borderStyle, app } from '../theme.js';
import { Logo } from './Logo.js';

interface LandingPageProps {
  onLogin: () => void;
}

export function LandingPage({ onLogin }: LandingPageProps) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
    if (key.return) {
      onLogin();
    }
  });

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
    >
      {/* Main container with border */}
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle={borderStyle}
        borderColor={theme.border}
        paddingX={4}
        paddingY={2}
        minWidth={40}
      >
        {/* Logo */}
        <Logo />

        {/* Version */}
        <Box marginBottom={2}>
          <Text color={theme.textDim}>v{app.version}</Text>
        </Box>

        {/* Login prompt */}
        <Box
          borderStyle={borderStyle}
          borderColor={theme.primaryDim}
          paddingX={3}
          paddingY={1}
          marginBottom={1}
        >
          <Text color={theme.text}>
            Press <Text color={theme.primary} bold>Enter</Text> to login
          </Text>
        </Box>

        {/* Quit hint */}
        <Box>
          <Text color={theme.textDim}>
            or <Text color={theme.textMuted}>'q'</Text> to quit
          </Text>
        </Box>
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={theme.textDim}>
          Hudl / VolleyMetrics Portal
        </Text>
      </Box>
    </Box>
  );
}
