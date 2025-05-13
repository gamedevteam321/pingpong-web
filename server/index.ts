import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface GameState {
  ball: {
    x: number;
    y: number;
    z: number;
    direction: { x: number; y: number; z: number };
  };
  paddles: {
    [playerId: string]: {
      x: number;
      y: number;
      z: number;
    };
  };
  score: {
    player1: number;
    player2: number;
  };
}

interface GameRoom {
  id: string;
  players: string[];
  gameState: GameState;
  isActive: boolean;
  readyPlayers: Set<string>;
}

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  path: '/socket.io/'
});

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connections: io.engine.clientsCount });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

const rooms = new Map<string, GameRoom>();

const createGameState = (): GameState => ({
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
  }
});

const generateRoomId = (): string => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

io.on('connection', (socket: Socket) => {
  console.log('Player connected:', socket.id);

  // Send immediate connection acknowledgment
  socket.emit('connect_ack', { id: socket.id });

  socket.on('disconnect', (reason) => {
    console.log('Player disconnected:', socket.id, 'Reason:', reason);
    // Clean up any rooms this player was in
    rooms.forEach((room, roomId) => {
      if (room.players.includes(socket.id)) {
        room.isActive = false;
        console.log(`Room ${roomId} deactivated due to player ${socket.id} disconnect`);
        socket.to(roomId).emit('playerDisconnected');
        rooms.delete(roomId);
      }
    });
  });

  socket.on('createRoom', () => {
    try {
      console.log(`Attempting to create room for player ${socket.id}`);
      const roomId = generateRoomId();
      console.log(`Generated room ID: ${roomId}`);

      const gameState = createGameState();
      console.log('Initial game state created:', gameState);

      gameState.paddles[socket.id] = { x: 0, y: 0.15, z: -9 }; // Host paddle
      
      const room: GameRoom = {
        id: roomId,
        players: [socket.id],
        gameState,
        isActive: false,
        readyPlayers: new Set()
      };
      
      rooms.set(roomId, room);
      console.log(`Room ${roomId} created with state:`, room);

      socket.join(roomId);
      console.log(`Player ${socket.id} joined room ${roomId}`);

      socket.emit('roomCreated', { 
        roomId,
        players: [socket.id]
      });
      console.log(`Room creation event emitted to player ${socket.id}`);
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('error', 'Failed to create room');
    }
  });

  socket.on('joinRoom', (roomId: string) => {
    try {
      console.log(`Player ${socket.id} attempting to join room ${roomId}`);
      const room = rooms.get(roomId);
      
      if (!room) {
        console.log(`Room ${roomId} not found`);
        socket.emit('error', 'Room not found');
        return;
      }

      if (room.players.length >= 2) {
        console.log(`Room ${roomId} is full`);
        socket.emit('error', 'Room is full');
        return;
      }

      room.players.push(socket.id);
      room.gameState.paddles[socket.id] = { x: 0, y: 0.15, z: 9 }; // Guest paddle
      socket.join(roomId);

      console.log(`Room ${roomId} updated state after player joined:`, {
        players: room.players,
        gameState: room.gameState
      });

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
      console.log(`Player ${socket.id} attempting to start game in room ${roomId}`);
      const room = rooms.get(roomId);
      
      if (!room) {
        console.log(`Room ${roomId} not found when trying to start game`);
        socket.emit('error', 'Room not found');
        return;
      }

      if (room.players.length !== 2) {
        console.log(`Cannot start game in room ${roomId}: not enough players`);
        socket.emit('error', 'Not enough players to start game');
        return;
      }

      if (socket.id !== room.players[0]) {
        console.log(`Player ${socket.id} is not authorized to start game in room ${roomId}`);
        socket.emit('error', 'Only host can start the game');
        return;
      }

      room.isActive = true;
      room.readyPlayers.clear(); // Reset ready players

      // Notify both players with their respective roles
      room.players.forEach((playerId, index) => {
        io.to(playerId).emit('gameStart', {
          gameState: room.gameState,
          players: room.players,
          isHost: index === 0,
          playerIndex: index
        });
      });

      console.log(`Game started in room ${roomId}`);
    } catch (error) {
      console.error('Error starting game:', error);
      socket.emit('error', 'Failed to start game');
    }
  });

  socket.on('paddleMove', ({ roomId, position }: { roomId: string; position: { x: number; y: number; z: number } }) => {
    try {
      const room = rooms.get(roomId);
      if (room && room.gameState.paddles[socket.id]) {
        room.gameState.paddles[socket.id] = position;
        socket.to(roomId).emit('opponentPaddleMove', {
          playerId: socket.id,
          position
        });
      }
    } catch (error) {
      console.error('Error updating paddle position:', error);
    }
  });

  socket.on('ballUpdate', ({ roomId, ballState }: { roomId: string; ballState: GameState['ball'] }) => {
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

  socket.on('scoreUpdate', ({ roomId, score }: { roomId: string; score: GameState['score'] }) => {
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

  socket.on('ready', ({ roomId }) => {
    try {
      console.log(`Player ${socket.id} ready in room ${roomId}`);
      const room = rooms.get(roomId);
      
      if (!room) {
        console.log(`Room ${roomId} not found for ready event`);
        socket.emit('error', 'Room not found');
        return;
      }

      if (!room.isActive) {
        console.log(`Game not started yet in room ${roomId}`);
        socket.emit('error', 'Game not started yet');
        return;
      }

      if (!room.players.includes(socket.id)) {
        console.log(`Player ${socket.id} not in room ${roomId}`);
        socket.emit('error', 'Player not in room');
        return;
      }

      room.readyPlayers.add(socket.id);
      console.log(`Room ${roomId} ready players: [${Array.from(room.readyPlayers).join(', ')}], total: ${room.readyPlayers.size}`);

      // If all players are ready, start the actual gameplay
      if (room.readyPlayers.size === room.players.length) {
        console.log(`All players ready in room ${roomId}, starting gameplay`);
        
        // Reset game state
        const paddlePositions = room.players.reduce<{ [key: string]: { x: number; y: number; z: number } }>((acc, playerId) => {
          acc[playerId] = { x: 0, y: 0.15, z: 0 }; // Paddle height/2
          return acc;
        }, {});

        room.gameState = {
          ball: {
            x: 0,
            y: 0.22, // Ball radius
            z: 0,
            direction: { x: 0, y: 0, z: 0 }
          },
          paddles: paddlePositions,
          score: { player1: 0, player2: 0 }
        };

        io.to(roomId).emit('allPlayersReady', {
          gameState: room.gameState,
          players: room.players
        });
      } else {
        console.log(`Waiting for more players to be ready in room ${roomId}`);
      }
    } catch (error) {
      console.error('Error handling ready state:', error);
      socket.emit('error', 'Failed to process ready state');
    }
  });
});

const PORT = process.env.PORT || 3001;

// Error handling for server startup
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on('error', (error) => {
  console.error('Failed to start server:', error);
}); 