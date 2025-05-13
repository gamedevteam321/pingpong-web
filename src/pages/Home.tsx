import { Typography, Box, Paper, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { keyframes } from '@mui/system';

const neonPulse = keyframes`
  0% {
    text-shadow: 0 0 10px #fff, 0 0 10px #fff, 0 0 30px rgb(0, 42, 255), 0 0 40px rgb(0, 17, 255);
  }
  100% {
    text-shadow: 0 0 5px #fff, 0 0 5px #fff, 0 0 15px rgb(34, 0, 255), 0 0 20px rgb(0, 34, 255);
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
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(to bottom, #000000, #1a1a1a)',
        padding: 2
      }}
    >
      <Paper 
        sx={{ 
          p: 6,
          maxWidth: 600,
          width: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(0, 55, 255, 0.1)',
          borderRadius: 4,
          boxShadow: '0 0 20px rgba(0, 34, 255, 0.2)'
        }}
      >
        <Typography 
          variant="h3" 
          component="h1" 
          gutterBottom
          sx={{
            color: '#ffffff',
            textAlign: 'center',
            fontWeight: 'bold',
            animation: `${neonPulse} 2s ease-in-out infinite alternate`,
            mb: 4
          }}
        >
          3D PING PONG
        </Typography>
        
        <Typography 
          variant="h6" 
          paragraph
          sx={{
            color: '#0ff',
            textAlign: 'center',
            mb: 4,
            textShadow: '0 0 5px rgba(0, 255, 255, 0.5)'
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
              px: 6,
              py: 2,
              fontSize: '1.2rem',
              backgroundColor: 'transparent',
              border: '2px solid #0ff',
              color: '#0ff',
              '&:hover': {
                backgroundColor: 'rgba(0, 255, 255, 0.1)',
                animation: `${buttonGlow} 1s ease-in-out infinite alternate`,
              },
              animation: `${buttonGlow} 2s ease-in-out infinite alternate`,
              textTransform: 'uppercase',
              letterSpacing: '2px'
            }}
          >
            Play Now
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

export default Home; 