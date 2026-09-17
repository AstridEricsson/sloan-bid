import { AppProvider, useApp } from './context/AppContext';
import { LoginScreen } from './screens/LoginScreen';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { PrioritizeScreen } from './screens/PrioritizeScreen';
import { ScheduleScreen } from './screens/ScheduleScreen';
import { BrowseScreen } from './screens/BrowseScreen';
import { BiddingScreen } from './screens/BiddingScreen';
import { Navigation } from './components/Navigation';
import { ChatWidget } from './components/ChatWidget';
import './index.css';

function AppInner() {
  const { screen } = useApp();

  if (screen === 'login') {
    return <LoginScreen />;
  }

  return (
    <div className="app-layout">
      <Navigation />
      <main className="main-content">
        {screen === 'discover' && <DiscoverScreen />}
        {screen === 'prioritize' && <PrioritizeScreen />}
        {screen === 'schedule' && <ScheduleScreen stage="need" />}
        {screen === 'schedule-nice' && <ScheduleScreen stage="nice" />}
        {screen === 'schedule-optional' && <ScheduleScreen stage="optional" />}
        {screen === 'browse' && <BrowseScreen />}
        {screen === 'bidding' && <BiddingScreen />}
      </main>
      <ChatWidget />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
