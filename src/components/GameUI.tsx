import { Box, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

interface GameUIProps {
  fps?: number;
}

const GameUI = ({ fps }: GameUIProps) => {
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowControls(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {/* Controls hint */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: 2,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          opacity: showControls ? 1 : 0,
          transition: 'opacity 0.5s ease-in-out',
        }}
      >
        <Box
          sx={{
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            padding: 2,
            borderRadius: 2,
            color: 'white',
          }}
        >
          <Typography variant="h4" align="center" gutterBottom>
            Use ← and → keys to move
          </Typography>
        </Box>
      </Box>

      {/* Back to menu button and FPS counter */}
      <Box
        sx={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          pointerEvents: 'auto',
        }}
      >
        <Typography
          component="a"
          href="/"
          sx={{
            color: 'white',
            textDecoration: 'none',
            padding: '8px 16px',
            borderRadius: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            '&:hover': {
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
            },
          }}
        >
          ← Back to Menu
        </Typography>
        <Typography
          sx={{
            color: '#00ff00',
            padding: '8px 16px',
            borderRadius: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            fontFamily: 'monospace',
          }}
        >
          FPS: {fps || 0}
        </Typography>
      </Box>
    </>
  );
};

export default GameUI; 