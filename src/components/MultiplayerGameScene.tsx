import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, Vector3, Clock, MathUtils } from 'three';
import { Text } from '@react-three/drei';
import { Socket } from 'socket.io-client';

// Game constants
const PADDLE_SPEED = 0.5;
const BALL_SPEED = 0.6;
const PADDLE_SIZE = { width: 2, height: 0.3, depth: 0.3 };
const BALL_RADIUS = 0.22;
const COURT_WIDTH = 10;
const COURT_LENGTH = 20;
const WALL_HEIGHT = 1;
const COLLISION_BUFFER = 0.05;
const WALL_BOUNCE_DAMPENING = 0.98;
const PADDLE_BOUNCE_BOOST = 1.04;
const MAX_BALL_SPEED = 0.9;

interface MultiplayerGameSceneProps {
  socket: Socket;
  roomId: string;
  isHost: boolean;
  onFpsUpdate: (fps: number) => void;
}

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

const MultiplayerGameScene = ({ socket, roomId, isHost, onFpsUpdate }: MultiplayerGameSceneProps) => {
  const ballRef = useRef<Mesh>(null);
  const player1Ref = useRef<Mesh>(null);
  const player2Ref = useRef<Mesh>(null);
  const [ballDirection, setBallDirection] = useState(new Vector3(0, 0, 1));
  const [score, setScore] = useState({ player1: 0, player2: 0 });
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  const clockRef = useRef(new Clock());
  const lastFrameTime = useRef(0);
  const frameCount = useRef(0);
  const lastFpsUpdate = useRef(0);
  const [gameStatus, setGameStatus] = useState<'waiting' | 'playing' | 'finished'>('waiting');
  const ballSpeedRef = useRef(BALL_SPEED);
  const [opponentPosition, setOpponentPosition] = useState({ x: 0, y: PADDLE_SIZE.height/2, z: COURT_LENGTH/2 - 1 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    socket.on('gameStart', (data: { gameState: GameState; players: string[]; isHost: boolean; playerIndex: number }) => {
      console.log('Game start event received in scene:', data);
      
      // Initialize game state
      if (ballRef.current) {
        ballRef.current.position.set(0, BALL_RADIUS, 0);
      }

      const localPlayerZ = isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1;
      const opponentZ = isHost ? COURT_LENGTH/2 - 1 : -COURT_LENGTH/2 + 1;

      if (player1Ref.current) {
        // Local player's paddle
        player1Ref.current.position.set(0, PADDLE_SIZE.height/2, localPlayerZ);
      }
      if (player2Ref.current) {
        // Opponent's paddle
        player2Ref.current.position.set(0, PADDLE_SIZE.height/2, opponentZ);
      }

      // Set initial ball direction for host
      if (isHost) {
        const initialDirection = new Vector3(
          (Math.random() - 0.5) * 0.2,
          0,
          Math.random() < 0.5 ? 1 : -1
        ).normalize();
        setBallDirection(initialDirection);
        
        // Emit initial ball state
        socket.emit('ballUpdate', {
          roomId,
          ballState: {
            x: 0,
            y: BALL_RADIUS,
            z: 0,
            direction: {
              x: initialDirection.x,
              y: initialDirection.y,
              z: initialDirection.z
            }
          }
        });
      }

      // Signal that we're ready to start
      console.log('Sending ready signal for room:', roomId);
      socket.emit('ready', { roomId });
    });

    socket.on('allPlayersReady', ({ gameState, players }) => {
      console.log('All players ready event received in scene:', { gameState, players });
      setGameStatus('playing');
      
      // Reset score
      setScore({ player1: 0, player2: 0 });
      
      // Reset ball speed
      ballSpeedRef.current = BALL_SPEED;

      // Initialize opponent position
      if (gameState.paddles) {
        const opponentId = players.find((id: string) => id !== socket.id);
        if (opponentId && gameState.paddles[opponentId]) {
          setOpponentPosition(gameState.paddles[opponentId]);
        }
      }
    });

    socket.on('opponentPaddleMove', ({ position }) => {
      setOpponentPosition(position);
      if (player2Ref.current) {
        player2Ref.current.position.x = position.x;
        player2Ref.current.position.y = position.y;
      }
    });

    socket.on('ballSync', (ballState: GameState['ball']) => {
      if (!isHost && ballRef.current) {
        ballRef.current.position.set(ballState.x, ballState.y, ballState.z);
        setBallDirection(new Vector3(ballState.direction.x, ballState.direction.y, ballState.direction.z));
      }
    });

    socket.on('scoreSync', (newScore: GameState['score']) => {
      setScore(newScore);
    });

    socket.on('playerDisconnected', () => {
      setGameStatus('finished');
    });

    return () => {
      socket.off('gameStart');
      socket.off('allPlayersReady');
      socket.off('opponentPaddleMove');
      socket.off('ballSync');
      socket.off('scoreSync');
      socket.off('playerDisconnected');
    };
  }, [socket, isHost, roomId]);

  const calculateBounceDirection = (hitPosition: number, currentDirection: Vector3, isPlayer1: boolean) => {
    const maxBounceAngle = 0.6;
    const bounceAngle = hitPosition * maxBounceAngle;
    const variation = (Math.random() - 0.5) * 0.1;
    
    return new Vector3(
      Math.sin(bounceAngle + variation),
      0,
      isPlayer1 ? 1 : -1
    ).normalize();
  };

  const checkWallCollision = (nextPosition: Vector3, currentDirection: Vector3) => {
    const leftWall = -COURT_WIDTH / 2 + BALL_RADIUS + COLLISION_BUFFER;
    const rightWall = COURT_WIDTH / 2 - BALL_RADIUS - COLLISION_BUFFER;
    
    if (nextPosition.x <= leftWall) {
      nextPosition.x = leftWall + COLLISION_BUFFER;
      return new Vector3(-currentDirection.x, 0, currentDirection.z);
    }
    if (nextPosition.x >= rightWall) {
      nextPosition.x = rightWall - COLLISION_BUFFER;
      return new Vector3(-currentDirection.x, 0, currentDirection.z);
    }
    return null;
  };

  const checkPaddleCollision = (
    paddlePosition: { x: number; y: number; z: number },
    isPlayer1: boolean,
    nextPosition: Vector3,
    currentDirection: Vector3
  ) => {
    const paddleZ = paddlePosition.z;
    const paddleX = paddlePosition.x;
    const paddleHalfWidth = PADDLE_SIZE.width/2;
    const paddleHalfDepth = PADDLE_SIZE.depth/2;
    
    const movingTowardsPaddle = (isPlayer1 && currentDirection.z < 0) || (!isPlayer1 && currentDirection.z > 0);
    
    if (
      Math.abs(nextPosition.z - paddleZ) < (paddleHalfDepth + BALL_RADIUS + COLLISION_BUFFER) &&
      Math.abs(nextPosition.x - paddleX) < (paddleHalfWidth + BALL_RADIUS) &&
      movingTowardsPaddle
    ) {
      const hitPosition = MathUtils.clamp((nextPosition.x - paddleX) / paddleHalfWidth, -1, 1);
      const newDirection = calculateBounceDirection(hitPosition, currentDirection, isPlayer1);
      
      nextPosition.z = paddleZ + (isPlayer1 ? 1 : -1) * (paddleHalfDepth + BALL_RADIUS + COLLISION_BUFFER * 2);
      ballSpeedRef.current = Math.min(ballSpeedRef.current * PADDLE_BOUNCE_BOOST, MAX_BALL_SPEED);
      
      return newDirection;
    }
    return null;
  };

  useFrame(() => {
    if (!ballRef.current || !player1Ref.current || gameStatus !== 'playing') return;

    const now = performance.now();
    const currentTime = now * 0.001;
    
    frameCount.current += 1;
    if (now - lastFpsUpdate.current >= 250) {
      const deltaTime = now - lastFpsUpdate.current;
      const fps = Math.round((frameCount.current * 1000) / deltaTime);
      onFpsUpdate(fps);
      frameCount.current = 0;
      lastFpsUpdate.current = now;
    }

    const delta = Math.min(currentTime - lastFrameTime.current, 1/144);
    lastFrameTime.current = currentTime;

    // Handle player paddle movement
    let targetX = player1Ref.current.position.x;
    if (keysPressed.current['ArrowLeft']) targetX -= PADDLE_SPEED * delta * 60;
    if (keysPressed.current['ArrowRight']) targetX += PADDLE_SPEED * delta * 60;

    targetX = MathUtils.clamp(
      targetX,
      -COURT_WIDTH / 2 + PADDLE_SIZE.width/2,
      COURT_WIDTH / 2 - PADDLE_SIZE.width/2
    );

    player1Ref.current.position.x = targetX;

    // Emit paddle position
    socket.emit('paddleMove', {
      roomId,
      position: {
        x: targetX,
        y: PADDLE_SIZE.height/2,
        z: isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1
      }
    });

    // Host handles ball physics
    if (isHost && ballRef.current) {
      const nextPosition = new Vector3().copy(ballRef.current.position).add(
        new Vector3(
          ballDirection.x * ballSpeedRef.current * delta * 60,
          0,
          ballDirection.z * ballSpeedRef.current * delta * 60
        )
      );

      const wallCollision = checkWallCollision(nextPosition, ballDirection);
      if (wallCollision) {
        setBallDirection(wallCollision);
        ballSpeedRef.current *= WALL_BOUNCE_DAMPENING;
        return;
      }

      // Check collisions with both paddles
      const localPlayerCollision = checkPaddleCollision(
        { x: player1Ref.current.position.x, y: PADDLE_SIZE.height/2, z: -COURT_LENGTH/2 + 1 },
        true,
        nextPosition,
        ballDirection
      );
      if (localPlayerCollision) {
        setBallDirection(localPlayerCollision);
        return;
      }

      const opponentCollision = checkPaddleCollision(
        { x: opponentPosition.x, y: PADDLE_SIZE.height/2, z: COURT_LENGTH/2 - 1 },
        false,
        nextPosition,
        ballDirection
      );
      if (opponentCollision) {
        setBallDirection(opponentCollision);
        return;
      }

      ballRef.current.position.copy(nextPosition);

      // Emit ball position
      socket.emit('ballUpdate', {
        roomId,
        ballState: {
          x: nextPosition.x,
          y: nextPosition.y,
          z: nextPosition.z,
          direction: { x: ballDirection.x, y: ballDirection.y, z: ballDirection.z }
        }
      });

      // Check for scoring
      if (nextPosition.z <= -COURT_LENGTH / 2 - BALL_RADIUS) {
        const newScore = { ...score, player2: score.player2 + 1 };
        setScore(newScore);
        socket.emit('scoreUpdate', { roomId, score: newScore });
        ballRef.current.position.set(0, BALL_RADIUS, 0);
        ballSpeedRef.current = BALL_SPEED;
      } else if (nextPosition.z >= COURT_LENGTH / 2 + BALL_RADIUS) {
        const newScore = { ...score, player1: score.player1 + 1 };
        setScore(newScore);
        socket.emit('scoreUpdate', { roomId, score: newScore });
        ballRef.current.position.set(0, BALL_RADIUS, 0);
        ballSpeedRef.current = BALL_SPEED;
      }
    }
  });

  return (
    <group position={[0, 0, 0]} rotation={[0, isHost ? 0 : Math.PI, 0]}>
      {/* Court */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        receiveShadow
      >
        <planeGeometry args={[COURT_WIDTH, COURT_LENGTH]} />
        <meshStandardMaterial color="#4a9eff" />
      </mesh>

      {/* Center line */}
      <mesh 
        position={[0, 0.01, 0]} 
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[0.1, COURT_LENGTH]} />
        <meshStandardMaterial color="#ffffff" opacity={0.5} transparent />
      </mesh>

      {/* Walls */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh 
            position={[side * (COURT_WIDTH/2), WALL_HEIGHT/2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.2, WALL_HEIGHT, COURT_LENGTH]} />
            <meshStandardMaterial color="#DAA520" />
          </mesh>
          <mesh 
            position={[side * (COURT_WIDTH/2), WALL_HEIGHT, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.3, 0.1, COURT_LENGTH]} />
            <meshStandardMaterial color="#B8860B" />
          </mesh>
        </group>
      ))}

      {/* Player paddle */}
      <mesh
        ref={player1Ref}
        position={[0, PADDLE_SIZE.height/2, -COURT_LENGTH/2 + 1]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[PADDLE_SIZE.width, PADDLE_SIZE.height, PADDLE_SIZE.depth]} />
        <meshStandardMaterial color="#4169E1" />
      </mesh>

      {/* Opponent paddle */}
      <mesh
        ref={player2Ref}
        position={[0, PADDLE_SIZE.height/2, COURT_LENGTH/2 - 1]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[PADDLE_SIZE.width, PADDLE_SIZE.height, PADDLE_SIZE.depth]} />
        <meshStandardMaterial color="#DC143C" />
      </mesh>

      {/* Ball */}
      <mesh 
        ref={ballRef} 
        position={[0, BALL_RADIUS, 0]}
        castShadow
      >
        <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {/* Score display */}
      <Text
        position={[0, 3, 0]}
        fontSize={0.8}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        rotation={[0, 0, 0]}
      >
        {`${score.player1} - ${score.player2}`}
      </Text>

      {gameStatus === 'waiting' && (
        <Text
          position={[0, 3, 0]}
          fontSize={1}
          color="#ffff00"
          anchorX="center"
          anchorY="middle"
          rotation={[0, 0, 0]}
        >
          Waiting for opponent...
        </Text>
      )}

      {gameStatus === 'finished' && (
        <Text
          position={[0, 3, 0]}
          fontSize={1}
          color="#ff0000"
          anchorX="center"
          anchorY="middle"
          rotation={[0, 0, 0]}
        >
          Opponent disconnected
        </Text>
      )}
    </group>
  );
};

export default MultiplayerGameScene; 