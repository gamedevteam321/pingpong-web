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
const COLLISION_BUFFER = 0.5;
const WALL_BOUNCE_DAMPENING = 0.98;
const PADDLE_BOUNCE_BOOST = 1.01;
const MAX_BALL_SPEED = 0.3;
const SYNC_RATE = 16;
const COLLISION_CHECK_STEPS = 24;
const SCORE_COOLDOWN = 3000;
const COUNTDOWN_STEPS = [3, 2, 1];
const SAFETY_ZONE = 1.0;

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
  const [debugVisible, setDebugVisible] = useState(false);
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
  const interpolatedOpponentPos = useRef({ x: 0, y: PADDLE_SIZE.height/2 });
  const lastSyncTime = useRef(0);
  const lastCollisionTime = useRef(0);
  const COLLISION_COOLDOWN = 50;
  const [countdown, setCountdown] = useState<number | null>(null);
  const [scoreCooldown, setScoreCooldown] = useState(false);
  const [lastScorer, setLastScorer] = useState<'player1' | 'player2' | null>(null);
  const cooldownTimer = useRef<NodeJS.Timeout | null>(null);
  const countdownTimers = useRef<NodeJS.Timeout[]>([]);
  const player1Velocity = useRef(0);
  const previousX = useRef(0);
  const lastBallPosition = useRef(new Vector3());
  const debugCollisionRef = useRef<Mesh>(null);
  const debugBallRef = useRef<Mesh>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = true;
      if (e.key === 'd' || e.key === 'D') {
        setDebugVisible(prev => !prev);
      }
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
    lastPosition: Vector3,
    nextPosition: Vector3,
    currentDirection: Vector3
  ) => {
    const now = performance.now();
    if (now - lastCollisionTime.current < COLLISION_COOLDOWN) return null;

    const paddleZ = paddlePosition.z;
    const paddleX = paddlePosition.x;

    // Expanded collision bounds
    const minZ = paddleZ - (PADDLE_SIZE.depth/2 + COLLISION_BUFFER + SAFETY_ZONE);
    const maxZ = paddleZ + (PADDLE_SIZE.depth/2 + COLLISION_BUFFER + SAFETY_ZONE);
    const minX = paddleX - (PADDLE_SIZE.width/2 + COLLISION_BUFFER);
    const maxX = paddleX + (PADDLE_SIZE.width/2 + COLLISION_BUFFER);

    // Check if ball is moving towards the paddle
    const movingTowardsPaddle = isPlayer1 ? 
      (currentDirection.z < 0 && lastPosition.z > paddleZ) :
      (currentDirection.z > 0 && lastPosition.z < paddleZ);

    if (!movingTowardsPaddle) return null;

    // Line segment intersection test
    const t = (paddleZ - lastPosition.z) / (nextPosition.z - lastPosition.z);
    if (t >= 0 && t <= 1) {
      const intersectX = lastPosition.x + t * (nextPosition.x - lastPosition.x);
      const withinPaddleX = intersectX >= minX && intersectX <= maxX;

      // Additional safety check for Z-axis
      const ballInZRange = isPlayer1 ?
        (lastPosition.z >= minZ && nextPosition.z <= maxZ) :
        (lastPosition.z <= maxZ && nextPosition.z >= minZ);

      if (withinPaddleX && ballInZRange) {
        lastCollisionTime.current = now;

        // Calculate bounce angle based on hit position
        const relativeX = intersectX - paddleX;
        const normalizedHitPos = relativeX / (PADDLE_SIZE.width/2);
        
        // More controlled bounce angle calculation
        const maxBounceAngle = Math.PI / 3; // 60 degrees
        const bounceAngle = normalizedHitPos * (maxBounceAngle * 0.8); // 80% of max angle
        
        // Apply paddle velocity influence
        const paddleVelocityInfluence = (paddlePosition.velocity || 0) * 0.1;
        const finalBounceAngle = MathUtils.clamp(
          bounceAngle + paddleVelocityInfluence,
          -maxBounceAngle,
          maxBounceAngle
        );

        // Calculate new direction
        const zDir = isPlayer1 ? 1 : -1;
        const newDirection = new Vector3(
          Math.sin(finalBounceAngle),
          0,
          zDir * Math.cos(finalBounceAngle)
        ).normalize();

        // Adjust ball speed with more controlled boost
        const speedBoost = 1.03 + Math.abs(paddleVelocityInfluence) * 0.1;
        ballSpeedRef.current = Math.min(
          ballSpeedRef.current * speedBoost,
          MAX_BALL_SPEED
        );

        // Push ball away from paddle to prevent multiple collisions
        if (isPlayer1) {
          nextPosition.z = paddleZ + PADDLE_SIZE.depth/2 + BALL_RADIUS + COLLISION_BUFFER;
        } else {
          nextPosition.z = paddleZ - PADDLE_SIZE.depth/2 - BALL_RADIUS - COLLISION_BUFFER;
        }

        return newDirection;
      }
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

  // Function to handle scoring
  const handleScoring = (scorer: 'player1' | 'player2') => {
    const newScore = { ...score, [scorer]: score[scorer] + 1 };
    setScore(newScore);
    setLastScorer(scorer);
    socket.emit('scoreUpdate', { roomId, score: newScore });

    // Reset ball position
    if (ballRef.current) {
      ballRef.current.position.set(0, BALL_RADIUS, 0);
      ballSpeedRef.current = BALL_SPEED;
    }

    // Reset paddles
    resetPaddles();

    // Set cooldown and start countdown
    setScoreCooldown(true);

    // Clear any existing countdown timers
    countdownTimers.current.forEach(timer => clearTimeout(timer));
    countdownTimers.current = [];

    // Start countdown sequence
    setCountdown(3);
    
    // Create countdown timers
    COUNTDOWN_STEPS.forEach((step, index) => {
      const timer = setTimeout(() => {
        setCountdown(step);
      }, index * 1000);
      countdownTimers.current.push(timer);
    });

    // Final timer to reset cooldown and resume game
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

        // Sync initial ball state after point
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

  useFrame((_, delta) => {
    // Check for cooldown first
    if (!ballRef.current || !player1Ref.current || gameStatus !== 'playing' || scoreCooldown) return;

    const now = performance.now();
    frameCount.current += 1;
    if (now - lastFpsUpdate.current >= 250) {
      const deltaTime = now - lastFpsUpdate.current;
      const fps = Math.round((frameCount.current * 1000) / deltaTime);
      onFpsUpdate(fps);
      frameCount.current = 0;
      lastFpsUpdate.current = now;
    }

    // Interpolate opponent position
    interpolatedOpponentPos.current.x = MathUtils.lerp(
      interpolatedOpponentPos.current.x,
      opponentPosition.x,
      0.2
    );
    interpolatedOpponentPos.current.y = MathUtils.lerp(
      interpolatedOpponentPos.current.y,
      opponentPosition.y,
      0.2
    );

    // Update opponent paddle position with interpolated values
    if (player2Ref.current) {
      player2Ref.current.position.x = interpolatedOpponentPos.current.x;
      player2Ref.current.position.y = interpolatedOpponentPos.current.y;
    }

    // Handle player paddle movement
    const moveDelta = PADDLE_SPEED * delta * 60;
    let targetX = player1Ref.current.position.x;

    if (keysPressed.current['ArrowLeft']) {
      targetX += isHost ? -moveDelta : moveDelta;
    }
    if (keysPressed.current['ArrowRight']) {
      targetX += isHost ? moveDelta : -moveDelta;
    }

    targetX = MathUtils.clamp(
      targetX,
      -COURT_WIDTH / 2 + PADDLE_SIZE.width/2,
      COURT_WIDTH / 2 - PADDLE_SIZE.width/2
    );

    // Calculate paddle velocity
    player1Velocity.current = (targetX - previousX.current) / delta;
    previousX.current = targetX;
    player1Ref.current.position.x = targetX;

    // Update debug visualization positions
    if (debugVisible) {
      if (debugCollisionRef.current) {
        debugCollisionRef.current.position.copy(player1Ref.current.position);
      }
      if (debugBallRef.current && ballRef.current) {
        debugBallRef.current.position.copy(ballRef.current.position);
      }
    }

    // Emit paddle movement
    socket.emit('paddleMove', {
      roomId,
      position: {
        x: targetX,
        y: PADDLE_SIZE.height/2,
        z: isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1,
        velocity: player1Velocity.current
      }
    });

    // Host handles ball physics
    if (isHost && ballRef.current) {
      const steps = COLLISION_CHECK_STEPS;
      const stepDelta = delta / steps;
      let collisionOccurred = false;

      for (let i = 0; i < steps; i++) {
        if (collisionOccurred) break;

        lastBallPosition.current.copy(ballRef.current.position);
        
        const moveAmount = new Vector3(
          ballDirection.x * ballSpeedRef.current * stepDelta * 60,
          0,
          ballDirection.z * ballSpeedRef.current * stepDelta * 60
        );

        // Limit maximum movement per step
        const maxMove = 0.05; // Reduced for more precise collision detection
        if (moveAmount.length() > maxMove) {
          moveAmount.normalize().multiplyScalar(maxMove);
        }

        const nextPosition = new Vector3().copy(ballRef.current.position).add(moveAmount);

        // Wall collisions
        const wallCollision = checkWallCollision(nextPosition, ballDirection);
        if (wallCollision) {
          setBallDirection(wallCollision);
          ballSpeedRef.current *= WALL_BOUNCE_DAMPENING;
          collisionOccurred = true;
          continue;
        }

        // Paddle positions with velocity
        const player1Pos = {
          x: player1Ref.current.position.x,
          y: PADDLE_SIZE.height/2,
          z: isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1,
          velocity: player1Velocity.current
        };

        const player2Pos = {
          x: interpolatedOpponentPos.current.x,
          y: PADDLE_SIZE.height/2,
          z: isHost ? COURT_LENGTH/2 - 1 : -COURT_LENGTH/2 + 1,
          velocity: 0
        };

        // Check paddle collisions
        const player1Collision = checkPaddleCollision(
          player1Pos,
          true,
          lastBallPosition.current,
          nextPosition,
          ballDirection
        );

        const player2Collision = checkPaddleCollision(
          player2Pos,
          false,
          lastBallPosition.current,
          nextPosition,
          ballDirection
        );

        if (player1Collision || player2Collision) {
          const newDirection = (player1Collision || player2Collision) as Vector3;
          setBallDirection(newDirection);
          collisionOccurred = true;
          
          // Immediate sync after collision
          socket.emit('ballUpdate', {
            roomId,
            ballState: {
              x: nextPosition.x,
              y: nextPosition.y,
              z: nextPosition.z,
              direction: newDirection.toArray(),
              speed: ballSpeedRef.current
            }
          });
          
          continue;
        }

        // Update ball position if no collision occurred
        ballRef.current.position.copy(nextPosition);
      }

      // Regular sync
      const now = performance.now();
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

      // Scoring checks
      if (ballRef.current.position.z <= -COURT_LENGTH/2 - BALL_RADIUS) {
        handleScoring('player2');
      } else if (ballRef.current.position.z >= COURT_LENGTH/2 + BALL_RADIUS) {
        handleScoring('player1');
      }
    }
  });

  // Add cleanup for timers in useEffect
  useEffect(() => {
    return () => {
      countdownTimers.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

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

      {/* Debug visualization */}
      {debugVisible && (
        <>
          {/* Paddle collision box visualization */}
          <mesh
            ref={debugCollisionRef}
            position={[0, PADDLE_SIZE.height/2, isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1]}
            visible={debugVisible}
          >
            <boxGeometry 
              args={[
                PADDLE_SIZE.width + COLLISION_BUFFER * 2,
                PADDLE_SIZE.height + COLLISION_BUFFER,
                PADDLE_SIZE.depth + COLLISION_BUFFER * 2
              ]} 
            />
            <meshBasicMaterial color="red" wireframe transparent opacity={0.5} />
          </mesh>

          {/* Ball collision sphere visualization */}
          <mesh
            ref={debugBallRef}
            position={[0, BALL_RADIUS, 0]}
            visible={debugVisible}
          >
            <sphereGeometry args={[BALL_RADIUS + COLLISION_BUFFER, 16, 16]} />
            <meshBasicMaterial color="blue" wireframe transparent opacity={0.5} />
          </mesh>
        </>
      )}
    </group>
  );
};

export default MultiplayerGameScene; 