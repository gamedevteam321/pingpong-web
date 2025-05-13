import { Box, Typography, Button, List, ListItem, ListItemText } from '@mui/material';
import { Socket } from 'socket.io-client';

interface GameLobbyProps {
  roomId: string;
  isHost: boolean;
  players: string[];
  onStartGame: () => void;
}

const GameLobby = ({ roomId, isHost, players, onStartGame }: GameLobbyProps) => {
  return (
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        bgcolor: 'rgba(0, 0, 0, 0.9)',
        p: 4,
        borderRadius: 2,
        minWidth: 300,
        color: 'white',
        textAlign: 'center'
      }}
    >
      <Typography variant="h4" sx={{ mb: 3 }}>
        Game Lobby
      </Typography>
      
      <Typography variant="h6" sx={{ mb: 2 }}>
        Room ID: {roomId}
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Players:
        </Typography>
        <List>
          {players.map((playerId, index) => (
            <ListItem key={playerId} sx={{ justifyContent: 'center' }}>
              <ListItemText 
                primary={`Player ${index + 1}${playerId === players[0] ? ' (Host)' : ''}`}
                sx={{ textAlign: 'center' }}
              />
            </ListItem>
          ))}
        </List>
      </Box>

      {players.length < 2 && (
        <Typography sx={{ mb: 2, color: 'yellow' }}>
          Waiting for players to join...
        </Typography>
      )}

      {isHost && players.length === 2 && (
        <Button
          variant="contained"
          color="primary"
          onClick={onStartGame}
          sx={{
            mt: 2,
            bgcolor: '#4CAF50',
            '&:hover': {
              bgcolor: '#45a049'
            }
          }}
        >
          Start Game
        </Button>
      )}

      {!isHost && players.length === 2 && (
        <Typography sx={{ color: 'lightblue' }}>
          Waiting for host to start the game...
        </Typography>
      )}
    </Box>
  );
};

export default GameLobby; 