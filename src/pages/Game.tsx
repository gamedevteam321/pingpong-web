import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useState, useEffect } from 'react';
import GameScene from '../components/GameScene';
import GameUI from '../components/GameUI';
import { Box } from '@mui/material';

const Game = () => {
  const [fps, setFps] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia('(max-width: 768px)').matches);
    };

    // Initial check
    checkMobile();

    // Add listener for screen size changes
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    mediaQuery.addListener(checkMobile);

    return () => {
      mediaQuery.removeListener(checkMobile);
    };
  }, []);

  return (
    <Box sx={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas
        shadows
        camera={{ 
          position: [0, 15, -20],
          fov: isMobile ? 60 : 45,
        }}
        style={{ background: '#111' }}
      >
        <Suspense fallback={null}>
          <OrbitControls enabled={false} />
          <ambientLight intensity={1} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={1}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <directionalLight
            position={[-10, 10, -5]}
            intensity={0.5}
          />
          <GameScene onFpsUpdate={setFps} />
        </Suspense>
      </Canvas>
      <GameUI fps={fps} />
    </Box>
  );
};

export default Game; 