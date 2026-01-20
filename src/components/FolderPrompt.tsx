/**
 * FolderPrompt - Modal for selecting download folder destination
 * 
 * Features:
 * - Show default download location option
 * - Allow custom folder naming with team name and timestamp
 * - Validate folder names
 * - Handle keyboard navigation (Enter, Esc, C for custom, Arrow keys for selection)
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, borderStyle } from '../theme.js';
import { generateBulkFolderName, getDisplayPath, sanitizeFolderName } from '../lib/download.js';

interface FolderPromptProps {
  teamName?: string;
  teamAbbrev?: string;
  onConfirm: (folderName: string | null) => void;
  onCancel: () => void;
}

type Mode = 'choosing' | 'naming';
type SelectedOption = 'default' | 'custom';

export function FolderPrompt({ teamName, teamAbbrev, onConfirm, onCancel }: FolderPromptProps) {
  const [mode, setMode] = useState<Mode>('choosing');
  const [selectedOption, setSelectedOption] = useState<SelectedOption>('default');
  const [customFolderName, setCustomFolderName] = useState('');
  
  const defaultFolderName = teamAbbrev 
    ? generateBulkFolderName(teamAbbrev)
    : generateBulkFolderName(teamName || 'MyTeam');
  
  const handleInput = (inputChar: string, key: any) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (mode === 'choosing') {
        if (selectedOption === 'default') {
          onConfirm(null);
        } else {
          setMode('naming');
        }
      } else {
        const sanitized = sanitizeFolderName(customFolderName) || defaultFolderName;
        onConfirm(sanitized);
      }
      return;
    }

    if (mode === 'naming') {
      if (key.backspace || key.delete) {
        setCustomFolderName(prev => prev.slice(0, -1));
        return;
      }

      if (inputChar.length === 1 && /[a-zA-Z0-9\-]/.test(inputChar)) {
        setCustomFolderName(prev => prev + inputChar);
      }
      return;
    }

    if (mode === 'choosing') {
      if (key.upArrow || key.downArrow) {
        setSelectedOption(prev => prev === 'default' ? 'custom' : 'default');
        return;
      }

      if (inputChar === 'c') {
        setSelectedOption('custom');
        setMode('naming');
        return;
      }
    }
  };

  useInput((inputChar, key) => {
    handleInput(inputChar, key);
  }, { isActive: true });

  const displayFolderName = mode === 'naming' ? customFolderName : '';

  return (
    <Box flexDirection="column" width="100%" padding={1}>
      <Box borderStyle={borderStyle} borderColor={theme.border} paddingX={2} paddingY={1}>
        <Text color={theme.accent} bold>Bulk Download Options</Text>
      </Box>

      <Box borderStyle={borderStyle} borderColor={theme.border} paddingX={1} paddingY={1}>
        {mode === 'choosing' && (
          <Box flexDirection="column">
            <Text color={theme.textDim}>
              Downloading {selectedOption === 'default' ? 'to default location' : 'with custom folder name'}.
            </Text>

            <Box flexDirection="column">
              {selectedOption === 'default' ? (
                <Text color={theme.primary} bold>
                  {String.fromCharCode(8250)} [Enter] Default location ({getDisplayPath()}/)
                </Text>
              ) : (
                <Text color={theme.textDim}>
                  {String.fromCharCode(8250)} [Enter] Default location ({getDisplayPath()}/)
                </Text>
              )}

              <Box>
                {selectedOption === 'custom' ? (
                  <Text color={theme.primary} bold>
                    {String.fromCharCode(8250)} [C] Custom folder ({defaultFolderName}/)
                  </Text>
                ) : (
                  <Text color={theme.textDim}>
                    {String.fromCharCode(8250)} [C] Custom folder ({defaultFolderName}/)
                  </Text>
                )}
              </Box>
            </Box>

            <Box flexDirection="column" marginTop={0}>
              <Text color={theme.textMuted}>
                Use ↑/↓ to navigate | [Esc] Cancel
              </Text>
            </Box>
          </Box>
        )}

        {mode === 'naming' && (
          <Box flexDirection="column">
            <Text color={theme.primary} bold>Enter folder name:</Text>

            <Box marginTop={0}>
              <Text color={theme.accent}>
                {displayFolderName}
                <Text backgroundColor={theme.primary}>_</Text>
              </Text>
            </Box>

            <Box marginTop={0}>
              <Text color={theme.textDim}>
                Location: {getDisplayPath()}/{displayFolderName || defaultFolderName}/
              </Text>
            </Box>

            <Box flexDirection="column" marginTop={0}>
              <Text color={theme.textMuted}>
                Type to edit | [Backspace] to delete | [Enter] to confirm | [Esc] Cancel
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
