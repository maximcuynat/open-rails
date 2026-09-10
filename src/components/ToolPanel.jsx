import { useState } from 'react';

// SVG Icons - Inspired by Cities: Skylines style
const IconSelect = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="9" cy="9" r="2"/>
    <circle cx="15" cy="15" r="2"/>
    <circle cx="15" cy="9" r="2"/>
    <circle cx="9" cy="15" r="2"/>
  </svg>
);

const IconRailStraight = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="12" x2="20" y2="12"/>
    <line x1="8" y1="10" x2="8" y2="14"/>
    <line x1="12" y1="10" x2="12" y2="14"/>
    <line x1="16" y1="10" x2="16" y2="14"/>
  </svg>
);

const IconRailCurve = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 4c-4 0-8 4-8 8s4 8 8 8 8-4 8-8-4-8-8-8z"/>
    <line x1="8" y1="12" x2="16" y2="12"/>
  </svg>
);

const IconSwitch = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="12" x2="12" y2="12"/>
    <line x1="12" y1="4" x2="20" y2="12"/>
    <line x1="12" y1="20" x2="20" y2="12"/>
  </svg>
);

const IconRailCross = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="12" x2="20" y2="12"/>
    <line x1="12" y1="4" x2="12" y2="20"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const IconTrain = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="10" width="16" height="6" rx="1"/>
    <circle cx="8" cy="16" r="2"/>
    <circle cx="16" cy="16" r="2"/>
    <path d="M8 10v-2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
);

const IconDelete = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);

const IconRotate = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 4h4v4"/>
    <path d="M16 20h4v-4"/>
    <path d="M4 16l-2-2 2-2"/>
    <path d="M20 16l2-2-2-2"/>
    <path d="M12 12L16 8"/>
  </svg>
);

export default function ToolPanel() {
  const [activeTool, setActiveTool] = useState('select');

  const tools = [
    { id: 'select', icon: <IconSelect />, label: 'Select' },
    { id: 'rail-straight', icon: <IconRailStraight />, label: 'Straight Rail' },
    { id: 'rail-curve', icon: <IconRailCurve />, label: 'Curve Rail' },
    { id: 'switch', icon: <IconSwitch />, label: 'Switch' },
    { id: 'rail-cross', icon: <IconRailCross />, label: 'Crossing' },
    { id: 'train', icon: <IconTrain />, label: 'Train' },
    { id: 'delete', icon: <IconDelete />, label: 'Delete' },
    { id: 'rotate', icon: <IconRotate />, label: 'Rotate' },
  ];

  return (
    <div className="tool-panel">
      {tools.map((tool) => (
        <button
          key={tool.id}
          className={`tool-button ${activeTool === tool.id ? 'active' : ''}`}
          onClick={() => setActiveTool(tool.id)}
          title={tool.label}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
