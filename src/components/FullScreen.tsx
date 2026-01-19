import React, { useState, useEffect, type ReactNode } from 'react';
import { Box, useStdout } from 'ink';
import { theme } from '../theme.js';

interface FullScreenProps {
  children: ReactNode;
}

export function FullScreen({ children }: FullScreenProps) {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns || 80,
    rows: stdout?.rows || 24,
  });

  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      setSize({
        columns: stdout.columns,
        rows: stdout.rows,
      });
    };

    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  return (
    <Box
      width={size.columns}
      height={size.rows}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      {children}
    </Box>
  );
}
