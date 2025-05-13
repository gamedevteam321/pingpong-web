import { ReactNode } from 'react';
import { AppBar, Toolbar, Typography, Container, Box } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';

interface LayoutProps {
  children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const location = useLocation();
  const isGamePage = location.pathname === '/game';

  if (isGamePage) {
    return <>{children}</>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '110vh' }}>
      
      <Container component="main" >
        {children}
      </Container>
      
    </Box>
  );
};

export default Layout; 