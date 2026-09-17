import { useApp } from '../context/AppContext';
import type { Screen } from '../types';

const NAV_ITEMS: { screen: Screen; label: string; icon: string }[] = [
  { screen: 'discover', label: 'Discover', icon: '◎' },
  { screen: 'prioritize', label: 'Prioritize', icon: '⊟' },
  { screen: 'schedule', label: 'Need-to-Have', icon: '▦' },
  { screen: 'schedule-nice', label: 'Nice-to-Have', icon: '▦' },
  { screen: 'schedule-optional', label: 'Optional', icon: '▦' },
  { screen: 'browse', label: 'Browse Compatible', icon: '⊕' },
  { screen: 'bidding', label: 'Bidding', icon: '⊘' },
];

export function Navigation() {
  const { screen, setScreen, student, addedCourses } = useApp();

  return (
    <nav className="navigation">
      <div className="nav-brand">
        <div className="nav-logo-mark">S</div>
        <span className="nav-logo-text">SloanBid</span>
      </div>

      <div className="nav-items">
        {NAV_ITEMS.map((item) => (
          <div key={item.screen}>
            {item.screen === 'schedule' && <div className="nav-group-label">Schedule</div>}
            <button
              className={`nav-item ${screen === item.screen ? 'active' : ''} ${
                item.screen === 'schedule' || item.screen === 'schedule-nice' || item.screen === 'schedule-optional'
                  ? 'nav-item-grouped'
                  : ''
              }`}
              onClick={() => setScreen(item.screen)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.screen === 'discover' && addedCourses.length > 0 && (
                <span className="nav-badge">{addedCourses.length}</span>
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="nav-footer">
        <div className="nav-student">
          <div className="nav-avatar">{student.name.charAt(0)}</div>
          <div className="nav-student-info">
            <div className="nav-student-name">{student.name}</div>
            <div className="nav-points">
              <span className="points-label">{student.program}</span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
