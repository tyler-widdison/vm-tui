import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { theme } from '../theme.js';

export function Logo() {
  const logoLines = [
    "                                                                           ░████    ",
    "                                             ░████                                  ",
    " ░████   ░████ ░████████████               ░████████████ ░████   ░████ ░████████    ",
    " ░████   ░████ ░████ ░██ ░██ ░████████████   ░████       ░████   ░████     ░████    ",
    " ░████   ░████ ░████ ░██ ░██                 ░████       ░████   ░████     ░████    ",
    "   ░████████   ░████ ░██ ░██                 ░████       ░████   ░████     ░████    ",
    "     ░████     ░████ ░██ ░██                   ░████████   ░██████████ ░████████████",
  ];

  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      {logoLines.map((line, index) => {
        const coloredLine = line
          .replace(/█/g, chalk.hex(theme.primary)('█'))
          .replace(/░/g, chalk.hex(theme.accent)('░'));
        
        return (
          <Text key={index}>
            {coloredLine}
          </Text>
        );
      })}
    </Box>
  );
}
