import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { theme } from '../theme.js';

export function Logo() {
  const logoLines = [
"                                           ▄▄  ",
" ▄▄  ▄▄  ▄▄▄▄▄▄          ▄██▄▄▄  ▄▄  ▄▄  ▄▄▄▄  ",
" ██  ██  ██ █ █  ▀▀▀▀▀▀   ██     ██  ██    ██  ",
"  ▀██▀   ██ █ █           ▀█▄▄▄  ▀█▄▄██  ▄▄██▄▄",
  ];

  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      {logoLines.map((line, index) => {
        return (
          <Text key={index}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
