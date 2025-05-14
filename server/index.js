import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: "*",
  methods: ['GET', 'POST'],
  credentials: true
}));

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  path: '/socket.io/'
});

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connections: io.engine.clientsCount,
    uptime: process.uptime()
  });
});

const rooms = new Map();

const createGameState = () => ({
  ball: {
    x: 0,
    y: 0.22, // Ball radius
    z: 0,
    direction: { x: 0, y: 0, z: 1 }
  },
  paddles: {},
  score: {
    player1: 0,
    player2: 0
  },
  isPlaying: false,
  hasStarted: false
});

const generateRoomId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('createRoom', () => {
    try {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const gameState = createGameState();
      gameState.paddles[socket.id] = { x: 0, y: 0.15, z: -9 }; // Host paddle
      
      rooms.set(roomId, {
        players: [socket.id],
        gameState,
        isActive: true
      });

      socket.join(roomId);
      socket.emit('roomCreated', { 
        roomId,
        players: [socket.id]
      });
      console.log(`Room ${roomId} created by ${socket.id}`);
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('error', 'Failed to create room');
    }
  });

  socket.on('joinRoom', (roomId) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', 'Room not found');
        return;
      }
      if (room.players.length >= 2) {
        socket.emit('error', 'Room is full');
        return;
      }

      room.players.push(socket.id);
      room.gameState.paddles[socket.id] = { x: 0, y: 0.15, z: 9 }; // Guest paddle
      
      socket.join(roomId);
      
      // Notify all players in the room about the new player
      io.to(roomId).emit('playerJoined', {
        players: room.players,
        gameState: room.gameState
      });
      
      console.log(`Player ${socket.id} joined room ${roomId}`);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', 'Failed to join room');
    }
  });

  socket.on('startGame', ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (room && room.players[0] === socket.id && room.players.length === 2) {
        room.gameState.hasStarted = true;
        room.gameState.isPlaying = true;
        io.to(roomId).emit('gameStart', {
          gameState: room.gameState,
          players: room.players
        });
        console.log(`Game started in room ${roomId}`);
      }
    } catch (error) {
      console.error('Error starting game:', error);
    }
  });

  socket.on('paddleMove', ({ roomId, position }) => {
    try {
      const room = rooms.get(roomId);
      if (room && room.gameState.paddles[socket.id]) {
        room.gameState.paddles[socket.id] = position;
        // Emit to all other players in the room
        socket.to(roomId).emit('opponentPaddleMove', {
          position: {
            x: position.x,
            y: position.y,
            z: position.z
          }
        });
      }
    } catch (error) {
      console.error('Error updating paddle position:', error);
    }
  });

  socket.on('ballUpdate', ({ roomId, ballState }) => {
    try {
      const room = rooms.get(roomId);
      if (room && room.players[0] === socket.id) { // Only the host updates ball position
        room.gameState.ball = ballState;
        socket.to(roomId).emit('ballSync', ballState);
      }
    } catch (error) {
      console.error('Error updating ball state:', error);
    }
  });

  socket.on('scoreUpdate', ({ roomId, score }) => {
    try {
      const room = rooms.get(roomId);
      if (room && room.players[0] === socket.id) {
        room.gameState.score = score;
        io.to(roomId).emit('scoreSync', score);
      }
    } catch (error) {
      console.error('Error updating score:', error);
    }
  });

  socket.on('disconnect', () => {
    try {
      console.log('Player disconnected:', socket.id);
      rooms.forEach((room, roomId) => {
        if (room.players.includes(socket.id)) {
          room.isActive = false;
          console.log(`Room ${roomId} deactivated due to player ${socket.id} disconnect`);
          socket.to(roomId).emit('playerDisconnected');
          rooms.delete(roomId);
        }
      });
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// Add error handling for the server
io.engine.on('connection_error', (err) => {
  console.error('Connection error:', err);
});

httpServer.on('error', (error) => {
  console.error('Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error('Port 3001 is already in use. Please free up the port and try again.');
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

// Add error handling for server startup
try {
  httpServer.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log(`For local network access, use: http://192.168.1.18:${PORT}`);
    console.log('WebSocket server is ready');
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
} 