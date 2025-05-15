import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, Vector3, Clock, MathUtils, Box3, Ray } from 'three';
import { Text } from '@react-three/drei';
import { Socket } from 'socket.io-client';

// Game constants
const PADDLE_SPEED = 0.3;
const BALL_SPEED = 0.5;
const PADDLE_SIZE = { width: 2, height: 0.3, depth: 0.3 };
const BALL_RADIUS = 0.22;
const COURT_WIDTH = 10;
const COURT_LENGTH = 20;
const WALL_HEIGHT = 1;
const COLLISION_BUFFER = 0.05;
const WALL_BOUNCE_DAMPENING = 0.98;
const PADDLE_BOUNCE_BOOST = 1.04;
const MAX_BALL_SPEED = 0.7;
const SYNC_RATE = 16;
const BASE_COLLISION_STEPS = 120;
const SCORE_COOLDOWN = 3000;
const COUNTDOWN_STEPS = [3, 2, 1];
const SAFETY_ZONE = 0.4;
const PADDLE_VELOCITY_INFLUENCE = 0.05;
const INTERPOLATION_SPEED = 0.4;
const VELOCITY_SMOOTHING = 0.8;
const MAX_MOVE_PER_FRAME = 0.05;
const COLLISION_COOLDOWN_FRAMES = 1;
const POST_COLLISION_FREEZE_FRAMES = 1;
const PADDLE_SYNC_INTERVAL = 500;

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
  const lastCollisionFrame = useRef(0);
  const postCollisionFreezeCounter = useRef(0);
  const previousBallStates = useRef<Array<{ position: Vector3, time: number }>>([]);
  const debugMissedCollisions = useRef(0);
  const [lastCollisionInfo, setLastCollisionInfo] = useState<{
    time: number;
    position: Vector3;
    type: 'paddle1' | 'paddle2' | 'wall';
  } | null>(null);

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
      if (!isHost && ballRef.current && ballState.speed) {
        // Predict ball position ahead by one frame to compensate for network delay
        const predictedPosition = new Vector3(
          ballState.x + ballState.direction[0] * ballState.speed * (1 / 60),
          ballState.y,
          ballState.z + ballState.direction[2] * ballState.speed * (1 / 60)
        );
        ballRef.current.position.copy(predictedPosition);
        setBallDirection(new Vector3(...ballState.direction));
        ballSpeedRef.current = ballState.speed;
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

  // Add paddle sync effect
  useEffect(() => {
    const syncInterval = setInterval(() => {
      if (player1Ref.current) {
        socket.emit('paddleSync', {
          roomId,
          position: {
            x: player1Ref.current.position.x,
            y: player1Ref.current.position.y,
            z: player1Ref.current.position.z
          }
        });
      }
    }, PADDLE_SYNC_INTERVAL);
    
    return () => clearInterval(syncInterval);
  }, [socket, roomId]);

  // Update socket listeners
  useEffect(() => {
    socket.on('paddleSync', ({ position }) => {
      if (position) {
        interpolatedOpponentPos.current.x = position.x;
      }
    });

    socket.on('ballSync', (ballState: GameState['ball']) => {
      if (!isHost && ballRef.current && ballState.speed) {
        // Predict ball position ahead by one frame to compensate for network delay
        const predictedPosition = new Vector3(
          ballState.x + ballState.direction[0] * ballState.speed * (1 / 60),
          ballState.y,
          ballState.z + ballState.direction[2] * ballState.speed * (1 / 60)
        );
        ballRef.current.position.copy(predictedPosition);
        setBallDirection(new Vector3(...ballState.direction));
        ballSpeedRef.current = ballState.speed;
      }
    });

    return () => {
      socket.off('paddleSync');
      socket.off('ballSync');
    };
  }, [socket, isHost]);

  const checkWallCollision = (nextPosition: Vector3, currentDirection: Vector3) => {
    const leftWall = -COURT_WIDTH / 2 + BALL_RADIUS + COLLISION_BUFFER;
    const rightWall = COURT_WIDTH / 2 - BALL_RADIUS - COLLISION_BUFFER;
    
    if (nextPosition.x <= leftWall) {
      nextPosition.x = leftWall + COLLISION_BUFFER;
      setLastCollisionInfo({
        time: performance.now(),
        position: new Vector3(leftWall, nextPosition.y, nextPosition.z),
        type: 'wall'
      });
      return new Vector3(-currentDirection.x, 0, currentDirection.z);
    }
    if (nextPosition.x >= rightWall) {
      nextPosition.x = rightWall - COLLISION_BUFFER;
      setLastCollisionInfo({
        time: performance.now(),
        position: new Vector3(rightWall, nextPosition.y, nextPosition.z),
        type: 'wall'
      });
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
    if (frameCount.current - lastCollisionFrame.current < COLLISION_COOLDOWN_FRAMES) {
      return null;
    }

    const paddleZ = paddlePosition.z;
    const paddleX = paddlePosition.x;
    const paddleY = PADDLE_SIZE.height / 2;

    // Create paddle bounding box with precise dimensions
    const paddleBox = new Box3().setFromCenterAndSize(
      new Vector3(paddleX, paddleY, paddleZ),
      new Vector3(
        PADDLE_SIZE.width + COLLISION_BUFFER,
        PADDLE_SIZE.height + COLLISION_BUFFER,
        PADDLE_SIZE.depth + COLLISION_BUFFER
      )
    );

    // Calculate ball movement vector
    const moveVector = nextPosition.clone().sub(lastPosition);
    const movementDistance = moveVector.length();
    
    // Create ray from ball's last position in its movement direction
    const ray = new Ray(lastPosition, moveVector.normalize());
    
    // Check if ball is moving towards the paddle
    const movingTowardsPaddle = isPlayer1 ? 
      (currentDirection.z < 0 && lastPosition.z > paddleZ - PADDLE_SIZE.depth * 2) :
      (currentDirection.z > 0 && lastPosition.z < paddleZ + PADDLE_SIZE.depth * 2);

    if (!movingTowardsPaddle) return null;

    // Perform ray-box intersection test with distance check
    const intersection = ray.intersectBox(paddleBox, new Vector3());
    if (intersection && intersection.distanceTo(lastPosition) <= movementDistance) {
      lastCollisionFrame.current = frameCount.current;
      postCollisionFreezeCounter.current = POST_COLLISION_FREEZE_FRAMES;

      // Calculate exact hit position on paddle
      const hitPoint = intersection.clone();
      const relativeX = (hitPoint.x - paddleX) / (PADDLE_SIZE.width / 2);
      
      // Update collision info for debugging
      setLastCollisionInfo({
        time: performance.now(),
        position: hitPoint,
        type: isPlayer1 ? 'paddle1' : 'paddle2'
      });

      // Calculate bounce angle based on hit position and paddle velocity
      const maxBounceAngle = Math.PI / 3;
      const baseAngle = relativeX * (maxBounceAngle * 0.8);
      
      // Add paddle velocity influence to bounce angle
      const paddleVelocityInfluence = (paddlePosition.velocity || 0) * PADDLE_VELOCITY_INFLUENCE;
      const finalBounceAngle = MathUtils.clamp(
        baseAngle + paddleVelocityInfluence,
        -maxBounceAngle,
        maxBounceAngle
      );

      // Calculate new direction vector
      const zDir = isPlayer1 ? 1 : -1;
      const newDirection = new Vector3(
        Math.sin(finalBounceAngle),
        0,
        zDir * Math.cos(finalBounceAngle)
      ).normalize();

      // Increase ball speed and apply bounce boost
      ballSpeedRef.current = Math.min(
        ballSpeedRef.current * PADDLE_BOUNCE_BOOST,
        MAX_BALL_SPEED
      );

      // Push ball away from paddle to prevent sticking
      const pushDistance = BALL_RADIUS + PADDLE_SIZE.depth/2 + COLLISION_BUFFER;
      if (isPlayer1) {
        nextPosition.z = paddleZ + pushDistance;
      } else {
        nextPosition.z = paddleZ - pushDistance;
      }

      return newDirection;
    }

    // Debug visualization
    if (debugVisible && debugCollisionRef.current) {
      debugCollisionRef.current.scale.set(
        PADDLE_SIZE.width + COLLISION_BUFFER,
        PADDLE_SIZE.height + COLLISION_BUFFER,
        PADDLE_SIZE.depth + COLLISION_BUFFER
      );
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

    // Improved paddle movement and interpolation
    const moveDelta = PADDLE_SPEED * Math.min(delta * 60, 2); // Cap delta time
    let targetX = player1Ref.current.position.x;

    if (keysPressed.current['ArrowLeft']) {
      targetX += isHost ? -moveDelta : moveDelta;
    }
    if (keysPressed.current['ArrowRight']) {
      targetX += isHost ? moveDelta : -moveDelta;
    }

    // Clamp target position
    targetX = MathUtils.clamp(
      targetX,
      -COURT_WIDTH / 2 + PADDLE_SIZE.width/2,
      COURT_WIDTH / 2 - PADDLE_SIZE.width/2
    );

    // Smooth velocity calculation with exponential moving average
    const rawVelocity = (targetX - previousX.current) / delta;
    player1Velocity.current = player1Velocity.current * VELOCITY_SMOOTHING + 
                            rawVelocity * (1 - VELOCITY_SMOOTHING);
    
    previousX.current = player1Ref.current.position.x;
    player1Ref.current.position.x = targetX;

    // Improved opponent interpolation with prediction
    if (player2Ref.current) {
      const predictedX = opponentPosition.x + (player2Ref.current.position.x - opponentPosition.x) * INTERPOLATION_SPEED;
      interpolatedOpponentPos.current.x = MathUtils.lerp(
        player2Ref.current.position.x,
        predictedX,
        INTERPOLATION_SPEED
      );
      player2Ref.current.position.x = interpolatedOpponentPos.current.x;
      
      // Update debug visualization if enabled
      if (debugVisible && debugCollisionRef.current && debugBallRef.current && ballRef.current) {
        debugCollisionRef.current.position.copy(player1Ref.current!.position);
        debugBallRef.current.position.copy(ballRef.current.position);
      }
    }

    // Host handles ball physics
    if (isHost && ballRef.current) {
      // Store ball state for lag compensation
      previousBallStates.current.push({
        position: ballRef.current.position.clone(),
        time: performance.now()
      });

      // Keep only last second of states
      while (previousBallStates.current.length > 0 && 
             performance.now() - previousBallStates.current[0].time > 1000) {
        previousBallStates.current.shift();
      }

      // Calculate dynamic collision steps based on ball speed
      const speedRatio = ballSpeedRef.current / BALL_SPEED;
      const dynamicSteps = Math.ceil(BASE_COLLISION_STEPS * speedRatio);
      const steps = Math.min(dynamicSteps, BASE_COLLISION_STEPS * 2); // Cap maximum steps

      const stepDelta = delta / steps;
      let collisionOccurred = false;

      // Skip physics update if in post-collision freeze
      if (postCollisionFreezeCounter.current > 0) {
        postCollisionFreezeCounter.current--;
        return;
      }

      for (let i = 0; i < steps && !collisionOccurred; i++) {
        lastBallPosition.current.copy(ballRef.current.position);
        
        // Calculate ball movement with speed limit
        const moveAmount = new Vector3(
          ballDirection.x * ballSpeedRef.current * stepDelta * 60,
          0,
          ballDirection.z * ballSpeedRef.current * stepDelta * 60
        );

        // Limit maximum movement per step to prevent tunneling
        if (moveAmount.length() > MAX_MOVE_PER_FRAME) {
          moveAmount.normalize().multiplyScalar(MAX_MOVE_PER_FRAME);
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

        // Paddle positions with predicted velocities
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
          velocity: player2Ref.current ? (interpolatedOpponentPos.current.x - player2Ref.current.position.x) / stepDelta : 0
        };

        // Check paddle collisions with improved positions
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
          
          // Immediate sync after collision with interpolation reset
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
          
          // Reset interpolation to prevent jitter
          if (player2Ref.current) {
            interpolatedOpponentPos.current.x = player2Ref.current.position.x;
          }
          
          continue;
        }

        if (!collisionOccurred) {
          ballRef.current.position.copy(nextPosition);
        }
      }

      // Regular sync with increased rate during fast movement
      const syncNeeded = now - lastSyncTime.current >= (
        Math.abs(player1Velocity.current) > PADDLE_SPEED/2 ? SYNC_RATE/2 : SYNC_RATE
      );
      
      if (syncNeeded) {
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

    // Emit paddle movement with velocity
    socket.emit('paddleMove', {
      roomId,
      position: {
        x: targetX,
        y: PADDLE_SIZE.height/2,
        z: isHost ? -COURT_LENGTH/2 + 1 : COURT_LENGTH/2 - 1,
        velocity: player1Velocity.current
      }
    });
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

      {/* Debug information display */}
      <group position={[0, 4, 0]}>
        {/* Ball speed */}
        <Text
          position={[-4, 0, 0]}
          fontSize={0.3}
          color="#00ff00"
          anchorX="left"
          anchorY="middle"
          rotation={[0, isHost ? 0 : Math.PI, 0]}
        >
          {`Ball Speed: ${ballSpeedRef.current.toFixed(3)}`}
        </Text>

        {/* Last collision info */}
        {lastCollisionInfo && performance.now() - lastCollisionInfo.time < 1000 && (
          <Text
            position={[-4, -0.4, 0]}
            fontSize={0.3}
            color="#ffff00"
            anchorX="left"
            anchorY="middle"
            rotation={[0, isHost ? 0 : Math.PI, 0]}
          >
            {`Last Hit: ${lastCollisionInfo.type} at ${lastCollisionInfo.position.x.toFixed(2)}`}
          </Text>
        )}

        {/* Missed collisions counter */}
        <Text
          position={[-4, -0.8, 0]}
          fontSize={0.3}
          color={debugMissedCollisions.current > 0 ? "#ff0000" : "#00ff00"}
          anchorX="left"
          anchorY="middle"
          rotation={[0, isHost ? 0 : Math.PI, 0]}
        >
          {`Missed Hits: ${debugMissedCollisions.current}`}
        </Text>
      </group>
    </group>
  );
};

export default MultiplayerGameScene; 