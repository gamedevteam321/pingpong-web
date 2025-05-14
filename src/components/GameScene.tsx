import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, Vector3, Clock, MathUtils } from 'three';
import { Text } from '@react-three/drei';
import { useThree } from '@react-three/fiber';

const PADDLE_SPEED = 0.3;
const BALL_SPEED = 0.5;
const PADDLE_ACCELERATION = 0.55;
const PADDLE_DECELERATION = 0.1;
const MOVEMENT_THRESHOLD = 0.1;
const COURT_WIDTH = 10;
const COURT_LENGTH = 20;
const WALL_HEIGHT = 1;
const PADDLE_SIZE = { width: 2, height: 0.3, depth: 0.3 };
const BALL_RADIUS = 0.22;
const COOLDOWN_TIME = 1.5;
const MAX_DELTA = 1/144;
const WINNING_SCORE = 11;
const FPS_UPDATE_INTERVAL = 250;
const AI_REACTION_TIME = 0.12;
const AI_BASE_SPEED = PADDLE_SPEED * 0.8;
const AI_PREDICTION_ERROR = 0.5;
const AI_DIFFICULTY_SCALE = 0.8;
const COLLISION_BUFFER = 0.05;
const WALL_BOUNCE_DAMPENING = 0.98;
const PADDLE_BOUNCE_BOOST = 1.04;
const MAX_BALL_SPEED = 0.7;

interface GameSceneProps {
  onFpsUpdate: (fps: number) => void;
}

const GameScene = ({ onFpsUpdate }: GameSceneProps) => {
  const { gl } = useThree();
  
  const ballRef = useRef<Mesh>(null);
  const player1Ref = useRef<Mesh>(null);
  const player2Ref = useRef<Mesh>(null);
  const [ballDirection, setBallDirection] = useState(new Vector3(0, 0, 1));
  const [score, setScore] = useState({ player1: 0, player2: 0 });
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  const [cooldown, setCooldown] = useState(0);
  const [lastScorer, setLastScorer] = useState<'player1' | 'player2' | null>(null);
  const aiTargetRef = useRef(0);
  const aiUpdateTimeRef = useRef(0);
  const clockRef = useRef(new Clock());
  const lastFrameTime = useRef(0);
  const [fps, setFps] = useState(0);
  const frameCount = useRef(0);
  const lastFpsUpdate = useRef(0);
  const [gameStatus, setGameStatus] = useState<'playing' | 'gamePoint' | 'deuce' | 'finished'>('playing');
  const [winner, setWinner] = useState<'player1' | 'player2' | null>(null);
  const paddleVelocity = useRef(0);
  const aiVelocity = useRef(0);
  const ballSpeedRef = useRef(BALL_SPEED);

  const gameInfo = useMemo(() => {
    const maxScore = Math.max(score.player1, score.player2);
    const scoreDiff = Math.abs(score.player1 - score.player2);
    
    if (maxScore >= WINNING_SCORE) {
      if (maxScore === WINNING_SCORE - 1) {
        const leader = score.player1 > score.player2 ? 'player1' : 'player2';
        return { status: 'gamePoint', message: 'Game Point!', leader };
      } else if (scoreDiff >= 2) {
        const winner = score.player1 > score.player2 ? 'player1' : 'player2';
        return { status: 'finished', message: 'Winner!', leader: winner };
      } else if (score.player1 === score.player2) {
        return { status: 'deuce', message: 'Deuce!', leader: null };
      } else {
        const leader = score.player1 > score.player2 ? 'player1' : 'player2';
        return { status: 'gamePoint', message: 'Advantage!', leader };
      }
    }
    return { status: 'playing', message: '', leader: null };
  }, [score]);

  useEffect(() => {
    setGameStatus(gameInfo.status as 'playing' | 'gamePoint' | 'deuce' | 'finished');
    if (gameInfo.status === 'finished') {
      setWinner(score.player1 > score.player2 ? 'player1' : 'player2');
    }
  }, [gameInfo]);

  const resetGame = useCallback(() => {
    setScore({ player1: 0, player2: 0 });
    setGameStatus('playing');
    setWinner(null);
    setCooldown(1.5);
    setLastScorer(null);
    ballSpeedRef.current = BALL_SPEED;
    resetBall();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = true;
      
      // Handle spacebar restart when game is finished
      if (e.code === 'Space' && gameStatus === 'finished') {
        resetGame();
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
  }, [gameStatus, resetGame]);

  useEffect(() => {
    gl.setPixelRatio(window.devicePixelRatio);
  }, [gl]);

  const calculateSmoothMovement = useCallback((
    delta: number,
    currentPos: number,
    targetPos: number,
    speed: number,
    velocity: number,
    acceleration: number = PADDLE_ACCELERATION,
    deceleration: number = PADDLE_DECELERATION
  ) => {
    const direction = targetPos - currentPos;
    const distance = Math.abs(direction);
    
    if (distance < MOVEMENT_THRESHOLD) {
      velocity = 0;
      return { position: currentPos, velocity };
    }

    if (Math.abs(velocity) < speed) {
      velocity += Math.sign(direction) * acceleration * delta * 60;
    }
    
    if (distance < 1 && Math.abs(velocity) > 0) {
      velocity *= (1 - deceleration * delta);
    }

    velocity = MathUtils.clamp(velocity, -speed, speed);
    
    const newPos = currentPos + velocity * delta * 60;
    
    return { 
      position: MathUtils.clamp(
        newPos,
        -COURT_WIDTH / 2 + PADDLE_SIZE.width/2,
        COURT_WIDTH / 2 - PADDLE_SIZE.width/2
      ),
      velocity
    };
  }, []);

  const calculateBounceDirection = useCallback((hitPosition: number, currentDirection: Vector3, isPlayer1: boolean) => {
    const maxBounceAngle = 0.6;
    const bounceAngle = hitPosition * maxBounceAngle;
    
    const variation = (Math.random() - 0.5) * 0.1;
    
    return new Vector3(
      Math.sin(bounceAngle + variation),
      0,
      isPlayer1 ? 1 : -1
    ).normalize();
  }, []);

  const checkWallCollision = useCallback((nextPosition: Vector3, currentDirection: Vector3) => {
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
  }, []);

  const checkPaddleCollision = useCallback((
    paddle: Mesh,
    isPlayer1: boolean,
    nextPosition: Vector3,
    currentDirection: Vector3
  ) => {
    const paddleZ = paddle.position.z;
    const paddleX = paddle.position.x;
    const paddleHalfWidth = PADDLE_SIZE.width/2;
    const paddleHalfDepth = PADDLE_SIZE.depth/2;
    
    // Check if ball is moving towards the paddle
    const movingTowardsPaddle = (isPlayer1 && currentDirection.z < 0) || (!isPlayer1 && currentDirection.z > 0);
    
    if (
      Math.abs(nextPosition.z - paddleZ) < (paddleHalfDepth + BALL_RADIUS + COLLISION_BUFFER) &&
      Math.abs(nextPosition.x - paddleX) < (paddleHalfWidth + BALL_RADIUS) &&
      movingTowardsPaddle
    ) {
      const hitPosition = MathUtils.clamp((nextPosition.x - paddleX) / paddleHalfWidth, -1, 1);
      const maxBounceAngle = 0.6;
      const bounceAngle = hitPosition * maxBounceAngle;
      
      const variation = (Math.random() - 0.5) * 0.1;
      
      const newDirection = new Vector3(
        Math.sin(bounceAngle + variation),
        0,
        isPlayer1 ? 1 : -1
      ).normalize();

      // Push ball outside of paddle to prevent sticking
      nextPosition.z = paddleZ + (isPlayer1 ? 1 : -1) * (paddleHalfDepth + BALL_RADIUS + COLLISION_BUFFER * 2);
      
      ballSpeedRef.current = Math.min(ballSpeedRef.current * PADDLE_BOUNCE_BOOST, MAX_BALL_SPEED);
      
      return newDirection;
    }
    return null;
  }, []);

  const updatePhysics = useCallback((delta: number) => {
    if (!ballRef.current || !player1Ref.current || !player2Ref.current) return;
    
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

    const player1Collision = checkPaddleCollision(player1Ref.current, true, nextPosition, ballDirection);
    if (player1Collision) {
      setBallDirection(player1Collision);
      return;
    }

    const player2Collision = checkPaddleCollision(player2Ref.current, false, nextPosition, ballDirection);
    if (player2Collision) {
      setBallDirection(player2Collision);
      return;
    }

    ballRef.current.position.copy(nextPosition);
  }, [ballDirection, checkWallCollision, checkPaddleCollision]);

  const updateAI = useCallback((delta: number) => {
    if (!ballRef.current || !player2Ref.current) return;

    aiUpdateTimeRef.current += delta;
    
    if (aiUpdateTimeRef.current >= AI_REACTION_TIME) {
      aiUpdateTimeRef.current = 0;
      const distanceFromAI = COURT_LENGTH/2 - Math.abs(ballRef.current.position.z);
      const errorScale = Math.min(1, distanceFromAI / (COURT_LENGTH/2));
      
      const predictedBallX = ballRef.current.position.x + 
        ballDirection.x * BALL_SPEED * (distanceFromAI / BALL_SPEED) * errorScale * 0.8;
      
      const randomError = (Math.random() - 0.5) * AI_PREDICTION_ERROR * errorScale;
      aiTargetRef.current = MathUtils.clamp(
        predictedBallX + randomError,
        -COURT_WIDTH / 2 + PADDLE_SIZE.width/2,
        COURT_WIDTH / 2 - PADDLE_SIZE.width/2
      );
    }

    const distanceScale = Math.min(1, Math.abs(ballRef.current.position.z - player2Ref.current.position.z) / (COURT_LENGTH/2));
    const currentAISpeed = AI_BASE_SPEED * (1 + (1 - distanceScale) * AI_DIFFICULTY_SCALE);

    const aiMovement = calculateSmoothMovement(
      delta,
      player2Ref.current.position.x,
      aiTargetRef.current,
      currentAISpeed,
      aiVelocity.current,
      PADDLE_ACCELERATION * 0.6,
      PADDLE_DECELERATION * 1.4
    );
    
    player2Ref.current.position.x = aiMovement.position;
    aiVelocity.current = aiMovement.velocity;
  }, [calculateSmoothMovement]);

  // Initialize game with cooldown
  useEffect(() => {
    setCooldown(1.5);
    const initialDirection = new Vector3(
      (Math.random() - 0.5) * 0.2,
      0,
      Math.random() < 0.5 ? 1 : -1
    ).normalize();
    setBallDirection(initialDirection);
  }, []);

  useFrame(() => {
    if (!ballRef.current || !player1Ref.current || !player2Ref.current) return;
    if (gameStatus === 'finished') return;

    const now = performance.now();
    const currentTime = now * 0.001;
    
    frameCount.current += 1;
    if (now - lastFpsUpdate.current >= FPS_UPDATE_INTERVAL) {
      const deltaTime = now - lastFpsUpdate.current;
      const fps = Math.round((frameCount.current * 1000) / deltaTime);
      onFpsUpdate(fps);
      frameCount.current = 0;
      lastFpsUpdate.current = now;
    }

    const rawDelta = currentTime - lastFrameTime.current;
    const delta = Math.min(rawDelta, MAX_DELTA);
    lastFrameTime.current = currentTime;

    if (cooldown > 0) {
      setCooldown(prev => {
        const newCooldown = Math.max(0, prev - delta);
        if (prev > 0 && newCooldown === 0) {
          if (lastScorer) {
            const initialDirection = new Vector3(
              (Math.random() - 0.5) * 0.2,
              0,
              lastScorer === 'player1' ? -1 : 1
            ).normalize();
            setBallDirection(initialDirection);
          }
          ballRef.current!.position.set(0, BALL_RADIUS, 0);
        }
        return newCooldown;
      });
      return;
    }

    let targetX = player1Ref.current.position.x;
    if (keysPressed.current['ArrowLeft']) targetX += PADDLE_SPEED;
    if (keysPressed.current['ArrowRight']) targetX -= PADDLE_SPEED;

    const playerMovement = calculateSmoothMovement(
      delta,
      player1Ref.current.position.x,
      targetX,
      PADDLE_SPEED,
      paddleVelocity.current
    );
    
    player1Ref.current.position.x = playerMovement.position;
    paddleVelocity.current = playerMovement.velocity;

    updatePhysics(delta);
    updateAI(delta);

    if (ballRef.current.position.z <= -COURT_LENGTH / 2 - BALL_RADIUS) {
      const newScore = { ...score, player2: score.player2 + 1 };
      requestAnimationFrame(() => {
        setScore(newScore);
        setLastScorer('player2');
        setCooldown(COOLDOWN_TIME);
        ballSpeedRef.current = BALL_SPEED;
      });
      resetBall();
    } else if (ballRef.current.position.z >= COURT_LENGTH / 2 + BALL_RADIUS) {
      const newScore = { ...score, player1: score.player1 + 1 };
      requestAnimationFrame(() => {
        setScore(newScore);
        setLastScorer('player1');
        setCooldown(COOLDOWN_TIME);
        ballSpeedRef.current = BALL_SPEED;
      });
      resetBall();
    }
  });

  const resetBall = () => {
    if (!ballRef.current || !player1Ref.current || !player2Ref.current) return;
    
    ballRef.current.position.set(0, BALL_RADIUS, 0);
    ballSpeedRef.current = BALL_SPEED;
    player1Ref.current.position.x = 0;
    player2Ref.current.position.x = 0;
    aiTargetRef.current = 0;
  };

  return (
    <group position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[COURT_WIDTH, COURT_LENGTH]} />
        <meshStandardMaterial color="#4a9eff" />
      </mesh>

      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh
            position={[side * (COURT_WIDTH/2), WALL_HEIGHT/2, 0]}
          >
            <boxGeometry args={[0.2, WALL_HEIGHT, COURT_LENGTH]} />
            <meshStandardMaterial color="#DAA520" />
          </mesh>
          <mesh
            position={[side * (COURT_WIDTH/2), WALL_HEIGHT, 0]}
          >
            <boxGeometry args={[0.3, 0.1, COURT_LENGTH]} />
            <meshStandardMaterial color="#B8860B" />
          </mesh>
        </group>
      ))}

      <mesh
        ref={player1Ref}
        position={[0, PADDLE_SIZE.height/2, -COURT_LENGTH/2 + 1]}
      >
        <boxGeometry args={[PADDLE_SIZE.width, PADDLE_SIZE.height, PADDLE_SIZE.depth]} />
        <meshStandardMaterial color="#4169E1" />
      </mesh>

      <mesh
        ref={player2Ref}
        position={[0, PADDLE_SIZE.height/2, COURT_LENGTH/2 - 1]}
      >
        <boxGeometry args={[PADDLE_SIZE.width, PADDLE_SIZE.height, PADDLE_SIZE.depth]} />
        <meshStandardMaterial color="#DC143C" />
      </mesh>

      <mesh ref={ballRef} position={[0, BALL_RADIUS, 0]}>
        <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {cooldown > 0 && (
        <Text
          position={[0, 3, 0]}
          fontSize={1}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          rotation={[0, Math.PI, 0]}
        >
          {cooldown > 1.0 ? "3" : cooldown > 0.5 ? "2" : "1"}
        </Text>
      )}

      <Text
        position={[0, 3, -COURT_LENGTH/4]}
        fontSize={0.8}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        rotation={[0, Math.PI, 0]}
      >
        {`${score.player1} - ${score.player2}`}
      </Text>

      {gameInfo.message && (
        <group>
          <Text
            position={[0, 3, gameInfo.leader === 'player2' ? COURT_LENGTH/2 - 2 : gameInfo.leader === 'player1' ? -COURT_LENGTH/2 + 2 : 0]}
            fontSize={1}
            color="#ffff00"
            anchorX="center"
            anchorY="middle"
            rotation={[0, Math.PI, 0]}
          >
            {gameInfo.message}
          </Text>
          {gameStatus === 'finished' && (
            <Text
              position={[0, 9, 0]}
              fontSize={0.7}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              rotation={[0, Math.PI, 0]}
            >
              Press SPACE to play again
            </Text>
          )}
        </group>
      )}
    </group>
  );
};

export default GameScene; 