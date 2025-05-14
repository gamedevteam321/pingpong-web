import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, Vector3, Clock, MathUtils } from 'three';
import { Text } from '@react-three/drei';
import { Socket } from 'socket.io-client';

// Game constants
const PADDLE_SPEED = 0.3;
const BALL_SPEED = 0.2;
const PADDLE_SIZE = { width: 2, height: 0.3, depth: 0.3 };
const BALL_RADIUS = 0.22;
const COURT_WIDTH = 10;
const COURT_LENGTH = 20;
const WALL_HEIGHT = 1;
const COLLISION_BUFFER = 0.25;
const WALL_BOUNCE_DAMPENING = 0.98;
const PADDLE_BOUNCE_BOOST = 1.01;
const MAX_BALL_SPEED = 0.3;
const SYNC_RATE = 16;
const COLLISION_CHECK_STEPS = 5;
const SCORE_COOLDOWN = 3000; // 3 seconds cooldown after scoring
const COUNTDOWN_STEPS = [3, 2, 1];

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
    direction: number[];
    speed?: number;
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
  const lastSyncTime = useRef(0);
  const lastCollisionTime = useRef(0);
  const COLLISION_COOLDOWN = 100;
  const [countdown, setCountdown] = useState<number | null>(null);
  const [scoreCooldown, setScoreCooldown] = useState(false);
  const [lastScorer, setLastScorer] = useState<'player1' | 'player2' | null>(null);
  const cooldownTimer = useRef<NodeJS.Timeout | null>(null);
  const countdownTimers = useRef<NodeJS.Timeout[]>([]);

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

      const localPlayerZ = isHost ? COURT_LENGTH/2 - 1 : -COURT_LENGTH/2 + 1;
      const opponentZ = isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1;

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
        const newDirection = new Vector3(
          ballState.direction[0],
          ballState.direction[1],
          ballState.direction[2]
        );
        setBallDirection(newDirection);
        if (ballState.speed) {
          ballSpeedRef.current = ballState.speed;
        }
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
    paddlePosition: { x: number; y: number; z: number; velocity?: number },
    isPlayer1: boolean,
    nextPosition: Vector3,
    currentDirection: Vector3
  ) => {
    const now = performance.now();
    if (now - lastCollisionTime.current < COLLISION_COOLDOWN) {
      return null;
    }

    const paddleZ = paddlePosition.z;
    const paddleX = paddlePosition.x;
    const paddleHalfWidth = PADDLE_SIZE.width/2;
    const paddleHalfDepth = PADDLE_SIZE.depth/2;

    // More precise collision bounds with increased buffer for host
    const collisionBuffer = isHost ? COLLISION_BUFFER * 1.2 : COLLISION_BUFFER;
    const withinX = Math.abs(nextPosition.x - paddleX) <= (paddleHalfWidth + BALL_RADIUS + collisionBuffer);
    const withinZ = Math.abs(nextPosition.z - paddleZ) <= (paddleHalfDepth + BALL_RADIUS + collisionBuffer);

    // Enhanced approach detection for host
    const ballVelocityZ = currentDirection.z * ballSpeedRef.current;
    const isApproaching = isPlayer1 ?
      (ballVelocityZ < 0 && nextPosition.z > paddleZ - paddleHalfDepth) :
      (ballVelocityZ > 0 && nextPosition.z < paddleZ + paddleHalfDepth);

    if (withinX && withinZ && isApproaching) {
      lastCollisionTime.current = now;

      // Calculate hit position with improved precision and paddle velocity influence
      const relativeX = nextPosition.x - paddleX;
      const normalizedHitPos = relativeX / (paddleHalfWidth + BALL_RADIUS);
      const hitPosition = MathUtils.clamp(normalizedHitPos, -0.95, 0.95);

      // Add paddle velocity influence to bounce angle
      const paddleVelocityInfluence = (paddlePosition.velocity || 0) * 0.3;
      const maxBounceAngle = 0.75;
      const bounceAngle = hitPosition * maxBounceAngle + paddleVelocityInfluence;
      
      // Determine bounce direction
      const zDirection = isPlayer1 ? 1 : -1;
      
      const newDirection = new Vector3(
        Math.sin(bounceAngle),
        0,
        Math.sign(zDirection) * Math.cos(bounceAngle)
      ).normalize();

      // Push ball away from paddle with increased margin for host
      const pushDistance = paddleHalfDepth + BALL_RADIUS + collisionBuffer * 3;
      nextPosition.z = paddleZ + (zDirection * pushDistance);

      // Gradual speed increase with paddle velocity boost
      const velocityBoost = Math.abs(paddlePosition.velocity || 0) * 0.01;
      ballSpeedRef.current = Math.min(
        ballSpeedRef.current * (PADDLE_BOUNCE_BOOST + velocityBoost),
        MAX_BALL_SPEED
      );

      return newDirection;
    }
    return null;
  };

  // Function to reset paddles to center
  const resetPaddles = () => {
    if (player1Ref.current) {
      player1Ref.current.position.x = 0;
    }
    // Emit our paddle position
    socket.emit('paddleMove', {
      roomId,
      position: {
        x: 0,
        y: PADDLE_SIZE.height/2,
        z: isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1
      }
    });
  };

  // Function to start countdown
  const startCountdown = () => {
    // Clear any existing timers
    countdownTimers.current.forEach(timer => clearTimeout(timer));
    countdownTimers.current = [];
    
    // Set initial countdown
    setCountdown(3);
    
    // Create timers for 3,2,1
    COUNTDOWN_STEPS.forEach((step, index) => {
      const timer = setTimeout(() => {
        setCountdown(step);
      }, index * 1000);
      countdownTimers.current.push(timer);
    });

    // Final timer to clear countdown and resume game
    const finalTimer = setTimeout(() => {
      setCountdown(null);
      setScoreCooldown(false);
      
      // Set ball direction towards the scorer
      if (isHost) {
        const direction = new Vector3(
          (Math.random() - 0.5) * 0.2,
          0,
          lastScorer === 'player1' ? -1 : 1
        ).normalize();
        setBallDirection(direction);
        
        socket.emit('ballUpdate', {
          roomId,
          ballState: {
            x: 0,
            y: BALL_RADIUS,
            z: 0,
            direction: direction.toArray(),
            speed: BALL_SPEED
          }
        });
      }
    }, SCORE_COOLDOWN);
    countdownTimers.current.push(finalTimer);
  };

  // Function to handle scoring
  const handleScoring = (scorer: 'player1' | 'player2') => {
    const newScore = { 
      ...score, 
      [scorer]: score[scorer] + 1 
    };
    setScore(newScore);
    setLastScorer(scorer);
    socket.emit('scoreUpdate', { roomId, score: newScore });
    
    // Reset ball and paddles
    if (ballRef.current) {
      ballRef.current.position.set(0, BALL_RADIUS, 0);
      ballSpeedRef.current = BALL_SPEED;
    }
    resetPaddles();

    // Start cooldown and countdown
    setScoreCooldown(true);
    startCountdown();
  };

  useFrame(() => {
    if (!ballRef.current || !player1Ref.current || gameStatus !== 'playing') return;
    if (scoreCooldown) return; // Don't update ball position during cooldown

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

    const delta = Math.min(currentTime - lastFrameTime.current, 1/60);
    lastFrameTime.current = currentTime;

    // Handle player paddle movement with rotation-aware controls
    let targetX = player1Ref.current.position.x;
    const moveAmount = PADDLE_SPEED * delta * 60;
    
    if (keysPressed.current['ArrowLeft']) {
      targetX += (isHost ? -moveAmount : moveAmount);
    }
    if (keysPressed.current['ArrowRight']) {
      targetX += (isHost ? moveAmount : -moveAmount);
    }

    targetX = MathUtils.clamp(
      targetX,
      -COURT_WIDTH / 2 + PADDLE_SIZE.width/2,
      COURT_WIDTH / 2 - PADDLE_SIZE.width/2
    );

    // Calculate paddle velocity for improved collision detection
    const paddleVelocity = (targetX - player1Ref.current.position.x) / delta;
    player1Ref.current.position.x = targetX;

    // Emit paddle position immediately after movement
    socket.emit('paddleMove', {
      roomId,
      position: {
        x: targetX,
        y: PADDLE_SIZE.height/2,
        z: isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1,
        velocity: paddleVelocity
      }
    });

    // Host handles ball physics
    if (isHost && ballRef.current) {
      const steps = COLLISION_CHECK_STEPS;
      const stepDelta = delta / steps;
      
      for (let i = 0; i < steps; i++) {
        const moveAmount = new Vector3(
          ballDirection.x * ballSpeedRef.current * stepDelta * 60,
          0,
          ballDirection.z * ballSpeedRef.current * stepDelta * 60
        );

        // Strict movement limit per step
        const maxMove = 0.1; // Reduced max movement
        if (moveAmount.length() > maxMove) {
          moveAmount.normalize().multiplyScalar(maxMove);
        }

        const nextPosition = new Vector3().copy(ballRef.current.position).add(moveAmount);
        let collisionOccurred = false;

        // Wall collisions
        const wallCollision = checkWallCollision(nextPosition, ballDirection);
        if (wallCollision) {
          setBallDirection(wallCollision);
          ballSpeedRef.current *= WALL_BOUNCE_DAMPENING;
          collisionOccurred = true;
        }

        // Player paddle collisions
        const player1Collision = checkPaddleCollision(
          {
            x: player1Ref.current.position.x,
            y: PADDLE_SIZE.height/2,
            z: -COURT_LENGTH/2 + 1
          },
          true,
          nextPosition,
          ballDirection
        );

        if (player1Collision) {
          setBallDirection(player1Collision);
          collisionOccurred = true;
        }

        const player2Collision = checkPaddleCollision(
          {
            x: opponentPosition.x,
            y: PADDLE_SIZE.height/2,
            z: COURT_LENGTH/2 - 1
          },
          false,
          nextPosition,
          ballDirection
        );

        if (player2Collision) {
          setBallDirection(player2Collision);
          collisionOccurred = true;
        }

        if (collisionOccurred) {
          // Immediate sync on collision
          socket.emit('ballUpdate', {
            roomId,
            ballState: {
              x: nextPosition.x,
              y: nextPosition.y,
              z: nextPosition.z,
              direction: ballDirection.toArray(),
              speed: ballSpeedRef.current
            }
          });
          break;
        }

        // Update position if no collision
        ballRef.current.position.copy(nextPosition);
      }

      // Regular sync
      if (now - lastSyncTime.current >= SYNC_RATE) {
        socket.emit('ballUpdate', {
          roomId,
          ballState: {
            x: ballRef.current.position.x,
            y: ballRef.current.position.y,
            z: ballRef.current.position.z,
            direction: ballDirection.toArray(),
            speed: ballSpeedRef.current
          }
        });
        lastSyncTime.current = now;
      }

      // Check for scoring
      if (ballRef.current.position.z <= -COURT_LENGTH / 2 - BALL_RADIUS) {
        handleScoring('player2');
      } else if (ballRef.current.position.z >= COURT_LENGTH / 2 + BALL_RADIUS) {
        handleScoring('player1');
      }
    }
  });

  return (
    <group position={[0, 0, 0]} rotation={[0, isHost ? Math.PI : 0, 0]}>
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
        position={[0, PADDLE_SIZE.height/2, isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[PADDLE_SIZE.width, PADDLE_SIZE.height, PADDLE_SIZE.depth]} />
        <meshStandardMaterial color="#4169E1" />
      </mesh>

      {/* Opponent paddle */}
      <mesh
        ref={player2Ref}
        position={[0, PADDLE_SIZE.height/2, isHost ? COURT_LENGTH/2 - 1 : -COURT_LENGTH/2 + 1]}
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

      {/* Score and text displays */}
      <group>
        {/* Center score display */}
        <group position={[0, 3, 0]}>
          <Text
            fontSize={0.8}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            rotation={[0, isHost ? 0 : Math.PI, 0]}
          >
            {`${score.player1} - ${score.player2}`}
          </Text>
        </group>

        {/* Status messages */}
        {gameStatus === 'waiting' && (
          <group position={[0, 3, 0]}>
            <Text
              fontSize={1}
              color="#ffff00"
              anchorX="center"
              anchorY="middle"
              rotation={[0, isHost ? 0 : Math.PI, 0]}
            >
              Waiting for opponent...
            </Text>
          </group>
        )}

        {gameStatus === 'finished' && (
          <group position={[0, 3, 0]}>
            <Text
              fontSize={1}
              color="#ff0000"
              anchorX="center"
              anchorY="middle"
              rotation={[0, isHost ? 0 : Math.PI, 0]}
            >
              Opponent disconnected
            </Text>
          </group>
        )}
      </group>

      {/* Countdown display */}
      {countdown !== null && (
        <group position={[0, 3, 0]}>
          <Text
            fontSize={2}
            color="#ffff00"
            anchorX="center"
            anchorY="middle"
            rotation={[0, isHost ? 0 : Math.PI, 0]}
          >
            {countdown}
          </Text>
        </group>
      )}
    </group>
  );
};

export default MultiplayerGameScene; 