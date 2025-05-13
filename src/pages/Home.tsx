import { Typography, Box, Paper, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { keyframes } from '@mui/system';

const neonPulse = keyframes`
  0% {
    text-shadow: 0 0 10px #fff, 0 0 20px #fff, 0 0 30px rgb(255, 255, 255), 0 0 40px rgb(0, 17, 255);
  }
  100% {
    text-shadow: 0 0 5px #fff, 0 0 10px #fff, 0 0 20px rgb(34, 0, 255), 0 0 30px rgb(0, 34, 255);
  }
`;

const buttonGlow = keyframes`
  0% {
    box-shadow: 0 0 5px #0ff, 0 0 10px #0ff, 0 0 15px #0ff;
  }
  100% {
    box-shadow: 0 0 10px #0ff, 0 0 20px #0ff, 0 0 30px #0ff;
  }
`;

const Home = () => {
  return (
    <Box 
      sx={{ 
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(to bottom, #000000, #1a1a1a)',
        m: 0,
        p: 0,
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      <Paper 
        elevation={0}
        sx={{ 
          width: '100%',
          height: '100%',
          backgroundColor: 'transparent',
          backdropFilter: 'blur(10px)',
          border: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          m: 0,
          p: 0
        }}
      >
        <Box
          sx={{
            maxWidth: '800px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            px: 2
          }}
        >
          <Typography 
            variant="h2" 
            component="h1" 
            gutterBottom
            sx={{
              color: '#ffffff',
              textAlign: 'center',
              fontWeight: 'bold',
              mb: 6,
              letterSpacing: '4px'
            }}
          >
            3D PING PONG
          </Typography>
          
          <Typography 
            variant="h5" 
            paragraph
            sx={{
              color: '#0ff',
              textAlign: 'center',
              mb: 6,
              textShadow: '0 0 5px rgba(0, 255, 255, 0.5)',
              letterSpacing: '1px'
            }}
          >
            Use the Left and Right arrow keys to move your paddle and try to beat the computer!
          </Typography>

          <Box sx={{ textAlign: 'center' }}>
            <Button
              component={Link}
              to="/game"
              variant="contained"
              size="large"
              sx={{
                mt: 2,
                px: 8,
                py: 2.5,
                fontSize: '1.4rem',
                backgroundColor: 'transparent',
                border: '2px solid #0ff',
                color: '#0ff',
                '&:hover': {
                  backgroundColor: 'rgba(0, 255, 255, 0.1)',
                  animation: `${buttonGlow} 1s ease-in-out infinite alternate`,
                },
                animation: `${buttonGlow} 2s ease-in-out infinite alternate`,
                textTransform: 'uppercase',
                letterSpacing: '3px',
                borderRadius: '4px'
              }}
            >
              Single Player
            </Button>
            <Button
              component={Link}
              to="/multiplayer"
              variant="contained"
              size="large"
              sx={{
                mt: 2,
                ml: 2,
                px: 8,
                py: 2.5,
                fontSize: '1.4rem',
                backgroundColor: 'transparent',
                border: '2px solid #ff0',
                color: '#ff0',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 0, 0.1)',
                  animation: `${buttonGlow} 1s ease-in-out infinite alternate`,
                },
                animation: `${buttonGlow} 2s ease-in-out infinite alternate`,
                textTransform: 'uppercase',
                letterSpacing: '3px',
                borderRadius: '4px'
              }}
            >
              Multiplayer
            </Button>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};

export default Home; 