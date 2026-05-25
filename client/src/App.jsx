import React from 'react';
import { useHashRoute } from './lib/router';
import Landing from './pages/Landing';
import Workspace from './pages/Workspace';
import ServiceDetail from './pages/ServiceDetail';
import ServiceLibrary from './pages/ServiceLibrary';

export default function App() {
  const { segments, path } = useHashRoute();

  // /                 → Landing
  // /app              → Workspace
  // /services         → ServiceLibrary
  // /services/:name   → ServiceDetail
  if (segments[0] === 'app') return <Workspace />;
  if (segments[0] === 'services' && segments[1]) return <ServiceDetail name={segments[1]} />;
  if (segments[0] === 'services') return <ServiceLibrary />;
  return <Landing />;
}
