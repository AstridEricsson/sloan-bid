import { useState } from 'react';
import { useApp } from '../context/AppContext';

export function LoginScreen() {
  const { setScreen, student } = useApp();
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setLoading(true);
    setTimeout(() => {
      setScreen('discover');
    }, 900);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-mark">S</div>
          <span className="logo-text">SloanBid</span>
        </div>

        <div className="login-divider" />

        <div className="login-heading-wrap">
          <h1 className="login-heading">Augment your capacity to choose.</h1>
        </div>

        <div className="login-student-preview">
          <div className="student-avatar">{student.name.charAt(0)}</div>
          <div>
            <div className="student-name">{student.name}</div>
            <div className="student-program">{student.program} · MIT Sloan</div>
          </div>
        </div>

        <button
          className={`login-btn ${loading ? 'loading' : ''}`}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <span className="spinner" />
          ) : (
            'Log In'
          )}
        </button>

        <p className="login-footnote">
          MIT Sloan School of Management · Course Selection
        </p>
      </div>

      <div className="login-bg-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>
    </div>
  );
}
