/**
 * ContentTypeSelector - Modal for selecting content types to download
 * 
 * Features:
 * - Select multiple content types (video, DVW, scoresheet)
 * - Shows count of available items per type
 * - Option for custom folder
 * - Keyboard navigation
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, borderStyle } from '../theme.js';
import type { BulkContentType } from '../lib/bulkDownloader.js';
import type { UnifiedContentAvailability } from '../lib/contentChecker.js';
import { getDisplayPath, generateBulkFolderName, sanitizeFolderName } from '../lib/download.js';

interface ContentTypeSelectorProps {
  selectedMatches: Array<{
    matchId: number;
    availability: UnifiedContentAvailability;
  }>;
  onConfirm: (contentTypes: Set<BulkContentType>, customFolder: string | null) => void;
  onCancel: () => void;
  teamAbbrev?: string;
}

type FocusArea = 'content-types' | 'folder-options' | 'folder-naming';
type ContentOption = 'video' | 'dvw' | 'scoresheet';
type FolderOption = 'default' | 'custom';

export function ContentTypeSelector({
  selectedMatches,
  onConfirm,
  onCancel,
  teamAbbrev,
}: ContentTypeSelectorProps) {
  // Count available content per type
  const videoCount = selectedMatches.filter(m => m.availability.video.available).length;
  const dvwCount = selectedMatches.filter(m => m.availability.dvw.available).length;
  const scoresheetCount = 0; // Scoresheets not yet implemented

  // Content type selection state
  const [selectedTypes, setSelectedTypes] = useState<Set<ContentOption>>(
    new Set(['video', 'dvw']) // Default to video and DVW
  );
  
  // Focus and navigation state
  const [focusArea, setFocusArea] = useState<FocusArea>('content-types');
  const [contentFocusIdx, setContentFocusIdx] = useState(0);
  const [folderOption, setFolderOption] = useState<FolderOption>('default');
  const [customFolderName, setCustomFolderName] = useState('');
  
  const contentOptions: ContentOption[] = ['video', 'dvw', 'scoresheet'];
  const defaultFolderName = generateBulkFolderName(teamAbbrev || 'Download');

  // Get count and availability info for each content type
  const getContentInfo = (type: ContentOption): { count: number; available: boolean; label: string } => {
    switch (type) {
      case 'video':
        return { count: videoCount, available: videoCount > 0, label: 'Videos' };
      case 'dvw':
        return { count: dvwCount, available: dvwCount > 0, label: 'DVW Files' };
      case 'scoresheet':
        return { count: scoresheetCount, available: false, label: 'Scoresheets (Coming Soon)' };
    }
  };

  // Toggle content type selection
  const toggleContentType = (type: ContentOption) => {
    if (type === 'scoresheet') return; // Can't select scoresheets yet
    
    const info = getContentInfo(type);
    if (!info.available) return; // Can't select if none available
    
    const newSet = new Set(selectedTypes);
    if (newSet.has(type)) {
      newSet.delete(type);
    } else {
      newSet.add(type);
    }
    setSelectedTypes(newSet);
  };

  // Handle confirmation
  const handleConfirm = () => {
    // Filter out scoresheet since it's not implemented
    const typesToDownload = new Set<BulkContentType>();
    if (selectedTypes.has('video')) typesToDownload.add('video');
    if (selectedTypes.has('dvw')) typesToDownload.add('dvw');
    
    if (typesToDownload.size === 0) {
      return; // Don't confirm with no types selected
    }
    
    const folder = folderOption === 'custom' 
      ? (sanitizeFolderName(customFolderName) || defaultFolderName)
      : null;
    
    onConfirm(typesToDownload, folder);
  };

  useInput((input, key) => {
    if (key.escape) {
      if (focusArea === 'folder-naming') {
        setFocusArea('folder-options');
      } else {
        onCancel();
      }
      return;
    }

    // Handle folder naming mode
    if (focusArea === 'folder-naming') {
      if (key.return) {
        handleConfirm();
        return;
      }
      if (key.backspace || key.delete) {
        setCustomFolderName(prev => prev.slice(0, -1));
        return;
      }
      if (input.length === 1 && /[a-zA-Z0-9\-_]/.test(input)) {
        setCustomFolderName(prev => prev + input);
      }
      return;
    }

    // Handle content-types focus
    if (focusArea === 'content-types') {
      if (key.upArrow || input === 'k') {
        setContentFocusIdx(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setContentFocusIdx(prev => Math.min(contentOptions.length - 1, prev + 1));
        return;
      }
      if (input === ' ') {
        toggleContentType(contentOptions[contentFocusIdx]!);
        return;
      }
      if (key.tab || key.return) {
        setFocusArea('folder-options');
        return;
      }
    }

    // Handle folder-options focus
    if (focusArea === 'folder-options') {
      if (key.upArrow || input === 'k') {
        setFolderOption('default');
        return;
      }
      if (key.downArrow || input === 'j') {
        setFolderOption('custom');
        return;
      }
      if (key.tab) {
        setFocusArea('content-types');
        return;
      }
      if (key.return) {
        if (folderOption === 'default') {
          handleConfirm();
        } else {
          setFocusArea('folder-naming');
        }
        return;
      }
      if (input === 'c') {
        setFolderOption('custom');
        setFocusArea('folder-naming');
        return;
      }
    }
  });

  // Count total selected items
  const totalSelected = selectedMatches.length;
  const totalToDownload = 
    (selectedTypes.has('video') ? videoCount : 0) +
    (selectedTypes.has('dvw') ? dvwCount : 0);

  return (
    <Box flexDirection="column" width="100%" padding={1} backgroundColor={theme.backgroundPanel}>
      {/* Header */}
      <Box borderStyle={borderStyle} borderColor={theme.border} paddingX={2} paddingY={1}>
        <Text color={theme.accent} bold>Download Content - {totalSelected} matches selected</Text>
      </Box>

      {/* Main content */}
      <Box borderStyle={borderStyle} borderColor={theme.border} paddingX={2} paddingY={1}>
        <Box flexDirection="column" width="100%">
          {/* Content Type Selection */}
          <Box flexDirection="column" marginBottom={1}>
            <Text color={theme.text} bold>Select Content Types:</Text>
            <Text color={theme.textDim}>(Space to toggle, Tab/Enter to continue)</Text>
            
            <Box flexDirection="column" marginTop={1}>
              {contentOptions.map((type, idx) => {
                const info = getContentInfo(type);
                const isSelected = selectedTypes.has(type);
                const isFocused = focusArea === 'content-types' && contentFocusIdx === idx;
                const isDisabled = !info.available || type === 'scoresheet';
                
                const checkbox = isDisabled ? '[-]' : (isSelected ? '[x]' : '[ ]');
                const textColor = isDisabled ? theme.textDim : (isFocused ? theme.primary : theme.text);
                const countColor = isDisabled ? theme.textDim : (info.count > 0 ? theme.success : theme.error);
                
                return (
                  <Box key={type}>
                    <Text
                      backgroundColor={isFocused ? theme.backgroundElement : undefined}
                      color={textColor}
                    >
                      {isFocused ? '>' : ' '} {checkbox} {info.label}
                    </Text>
                    <Text color={countColor}> ({info.count} available)</Text>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Folder Selection */}
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.text} bold>Download Location:</Text>
            
            {focusArea !== 'folder-naming' && (
              <Box flexDirection="column" marginTop={1}>
                <Box>
                  <Text
                    backgroundColor={focusArea === 'folder-options' && folderOption === 'default' ? theme.backgroundElement : undefined}
                    color={focusArea === 'folder-options' && folderOption === 'default' ? theme.primary : theme.text}
                  >
                    {focusArea === 'folder-options' && folderOption === 'default' ? '>' : ' '}
                    {folderOption === 'default' ? '(*)' : '( )'} Default: {getDisplayPath()}/
                  </Text>
                </Box>
                <Box>
                  <Text
                    backgroundColor={focusArea === 'folder-options' && folderOption === 'custom' ? theme.backgroundElement : undefined}
                    color={focusArea === 'folder-options' && folderOption === 'custom' ? theme.primary : theme.text}
                  >
                    {focusArea === 'folder-options' && folderOption === 'custom' ? '>' : ' '}
                    {folderOption === 'custom' ? '(*)' : '( )'} Custom folder [c]
                  </Text>
                </Box>
              </Box>
            )}
            
            {focusArea === 'folder-naming' && (
              <Box flexDirection="column" marginTop={1}>
                <Text color={theme.primary}>Enter folder name:</Text>
                <Box marginTop={0}>
                  <Text color={theme.accent}>
                    {customFolderName}
                    <Text backgroundColor={theme.primary}>_</Text>
                  </Text>
                </Box>
                <Text color={theme.textDim}>
                  Will create: {getDisplayPath()}/{customFolderName || defaultFolderName}/
                </Text>
                <Text color={theme.textDim}>
                  With subfolders: /videos/, /dvw/
                </Text>
              </Box>
            )}
          </Box>

          {/* Summary */}
          <Box marginTop={1} paddingTop={1} borderStyle="single" borderTop borderLeft={false} borderRight={false} borderBottom={false} borderColor={theme.borderSubtle}>
            <Text color={theme.textMuted}>
              Will download: <Text color={theme.success}>{totalToDownload}</Text> items
            </Text>
          </Box>

          {/* Footer */}
          <Box marginTop={1}>
            <Text color={theme.textDim}>
              [Tab] Switch focus | [Space] Toggle | [Enter] Confirm | [Esc] Cancel
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
