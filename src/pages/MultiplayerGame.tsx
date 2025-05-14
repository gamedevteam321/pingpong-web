import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useState, useEffect, useRef } from 'react';
import { Box, Button, TextField, Typography, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress } from '@mui/material';
import { io, Socket } from 'socket.io-client';
import MultiplayerGameScene from '../components/MultiplayerGameScene';
import GameUI from '../components/GameUI';
import GameLobby from '../components/GameLobby';

const MultiplayerGame = () => {
  const [fps, setFps] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(true);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [players, setPlayers] = useState<string[]>([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    socketRef.current = io('http://192.168.1.18:3001', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
      path: '/socket.io/',
      withCredentials: true,
      extraHeaders: {
        'Access-Control-Allow-Origin': '*'
      }
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Connected to server with ID:', socket.id);
      setIsConnecting(false);
      setConnectionError(null);
      setIsConnected(true);
    });

    socket.on('roomCreated', ({ roomId: newRoomId, players }) => {
      console.log('Room created event received:', { roomId: newRoomId, players });
      setRoomId(newRoomId);
      setPlayers(players);
      setIsHost(true);
      setShowJoinDialog(false);
      setError(null);
    });

    socket.on('playerJoined', ({ players, gameState }) => {
      console.log('Player joined event received:', { players, gameState });
      setPlayers(players);
    });

    socket.on('gameStart', ({ gameState, players, isHost: serverIsHost, playerIndex }) => {
      console.log('Game start event received in game component:', { gameState, players, isHost: serverIsHost, playerIndex });
      setGameStarted(true);
      setShowJoinDialog(false);
      setIsHost(serverIsHost);
      setPlayers(players);
      setError(null);
    });

    socket.on('allPlayersReady', ({ gameState, players }) => {
      console.log('All players ready event received in game component:', { gameState, players });
      setGameStarted(true);
      setPlayers(players);
      setError(null);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      setError(error.toString());
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      setIsConnected(false);
      setConnectionError('Lost connection to server');
      setGameStarted(false);
      setRoomId(null);
      setPlayers([]);
      setIsHost(false);
      setError(null);
    });

    socket.on('playerDisconnected', () => {
      console.log('Player disconnected, resetting game state');
      setGameStarted(false);
      setPlayers([]);
      setError('Opponent disconnected');
    });

    return () => {
      if (socket.connected) {
        socket.removeAllListeners();
        socket.close();
      }
    };
  }, []);

  const handleCreateRoom = () => {
    try {
      if (!socketRef.current) {
        console.error('Socket not initialized');
        setError('Socket connection not initialized');
        return;
      }

      if (!socketRef.current.connected) {
        console.error('Socket not connected');
        setError('Not connected to server');
        return;
      }

      setError(null);
      console.log('Creating room with socket ID:', socketRef.current.id);
      socketRef.current.emit('createRoom');
    } catch (error) {
      console.error('Error creating room:', error);
      setError('Failed to create room');
    }
  };

  const handleJoinRoom = () => {
    try {
      if (!socketRef.current) {
        console.error('Socket not initialized');
        setError('Socket connection not initialized');
        return;
      }

      if (!socketRef.current.connected) {
        console.error('Socket not connected');
        setError('Not connected to server');
        return;
      }

      if (!joinRoomId) {
        setError('Please enter a room ID');
        return;
      }

      setError(null);
      console.log('Joining room:', joinRoomId);
      socketRef.current.emit('joinRoom', joinRoomId);
      setRoomId(joinRoomId);
      setIsHost(false);
      setShowJoinDialog(false);
      setGameStarted(true);
    } catch (error) {
      console.error('Error joining room:', error);
      setError('Failed to join room');
      setGameStarted(false);
    }
  };

  const handleStartGame = () => {
    try {
      console.log('Starting game...', { roomId, isHost });
      if (socketRef.current && roomId) {
        setError(null);
        setGameStarted(true);
        socketRef.current.emit('startGame', { roomId });
      }
    } catch (error) {
      console.error('Error starting game:', error);
      setError('Failed to start game');
      setGameStarted(false);
    }
  };

  console.log('Rendering MultiplayerGame with state:', {
    roomId,
    isHost,
    gameStarted,
    players,
    showJoinDialog
  });

  // Show connection error dialog
  if (connectionError) {
    return (
      <Box sx={{ 
        width: '100vw', 
        height: '100vh', 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        background: '#111'
      }}>
        <Dialog 
          open={true} 
          onClose={() => {}}
          PaperProps={{
            sx: {
              minWidth: '300px',
              maxWidth: '400px',
              margin: 0
            }
          }}
          sx={{
            '& .MuiDialog-container': {
              alignItems: 'center',
              justifyContent: 'center'
            }
          }}
        >
          <DialogTitle>Connection Error</DialogTitle>
          <DialogContent>
            <Typography color="error">{connectionError}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  // Show loading state
  if (isConnecting) {
    return (
      <Box
        sx={{
          width: '100vw',
          height: '100vh',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          margin: 0,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 2,
          background: '#111',
          overflow: 'hidden'
        }}
      >
        <CircularProgress />
        <Typography color="white">Connecting to server...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      width: '100vw', 
      height: '100vh', 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      margin: 0,
      padding: 0,
      overflow: 'hidden',
      background: '#111'
    }}>
      <Canvas
        shadows
        camera={{ 
          position: [0, 15, isHost ? 20 : -20],
          fov: 45,
          near: 0.1,
          far: 1000
        }}
        style={{ 
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'block'
        }}
      >
        <Suspense fallback={null}>
          <OrbitControls enabled={false} />
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={0.7}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <directionalLight
            position={[-10, 10, -5]}
            intensity={0.3}
          />
          {roomId && socketRef.current && (
            <MultiplayerGameScene
              socket={socketRef.current}
              roomId={roomId}
              isHost={isHost}
              onFpsUpdate={setFps}
            />
          )}
        </Suspense>
      </Canvas>

      {roomId && !gameStarted && (
        <GameLobby
          roomId={roomId}
          isHost={isHost}
          players={players}
          onStartGame={handleStartGame}
        />
      )}

      <GameUI fps={fps} />

      {/* Room ID display */}
      {roomId && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            padding: 2,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            borderRadius: 1,
            color: 'white',
          }}
        >
          <Typography>Room ID: {roomId}</Typography>
        </Box>
      )}

      {/* Join/Create Room Dialog */}
      <Dialog 
        open={showJoinDialog} 
        onClose={() => {}}
        PaperProps={{
          sx: {
            minWidth: '300px',
            maxWidth: '400px',
            margin: 0
          }
        }}
        sx={{
          '& .MuiDialog-container': {
            alignItems: 'center',
            justifyContent: 'center',
            margin: 0,
            padding: 0
          },
          '& .MuiDialog-paper': {
            margin: 0
          }
        }}
      >
        <DialogTitle sx={{ textAlign: 'center', padding: 2, margin: 0 }}>Multiplayer Game</DialogTitle>
        <DialogContent sx={{ padding: 2, margin: 0 }}>
          {error && (
            <Typography color="error" sx={{ mb: 2 }}>
              {error}
            </Typography>
          )}
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: 2,
            width: '100%',
            margin: 0,
            padding: 0
          }}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleCreateRoom}
              fullWidth
              disabled={!isConnected || isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Create New Room'}
            </Button>
            <Typography align="center">- OR -</Typography>
            <TextField
              label="Room ID"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
              fullWidth
              placeholder="Enter room ID"
              disabled={!isConnected || isConnecting}
            />
            <Button
              variant="contained"
              color="secondary"
              onClick={handleJoinRoom}
              disabled={!isConnected || isConnecting || !joinRoomId}
              fullWidth
            >
              {isConnecting ? 'Connecting...' : 'Join Room'}
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default MultiplayerGame; 