import { useState } from 'react';

export default function ToolPanel() {
  const [activeTool, setActiveTool] = useState('select');

  const tools = [
    { 
      id: 'select', 
      label: 'Select',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
        <rect x="5" y="5" width="14" height="14" rx="2"/>
        <circle cx="12" cy="12" r="2"/>
        <path d="M12 5v2M12 17v2M5 12h2M17 12h2"/>
      </svg>
    },
    { 
      id: 'rail-straight', 
      label: 'Straight Rail',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="7" y1="10" x2="7" y2="14"/>
        <line x1="10" y1="10" x2="10" y2="14"/>
        <line x1="13" y1="10" x2="13" y2="14"/>
        <line x1="16" y1="10" x2="16" y2="14"/>
        <line x1="19" y1="10" x2="19" y2="14"/>
      </svg>
    },
    { 
      id: 'rail-curve', 
      label: 'Curve Rail',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
        <path d="M4 12c0-4 4-8 8-8s8 4 8 8" />
        <line x1="8" y1="10" x2="8" y2="14"/>
        <line x1="12" y1="10" x2="12" y2="14"/>
        <line x1="16" y1="10" x2="16" y2="14"/>
      </svg>
    },
    { 
      id: 'switch', 
      label: 'Switch',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
        <line x1="4" y1="12" x2="10" y2="12"/>
        <line x1="14" y1="12" x2="20" y2="12"/>
        <path d="M10 12 L14 8 L14 16 Z"/>
      </svg>
    },
    { 
      id: 'rail-cross', 
      label: 'Crossing',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="12" y1="4" x2="12" y2="20"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    },
    { 
      id: 'train', 
      label: 'Train',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
        <rect x="3" y="10" width="18" height="7" rx="2"/>
        <circle cx="7" cy="16" r="1.5"/>
        <circle cx="17" cy="16" r="1.5"/>
        <path d="M7 10V8a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>
        <line x1="12" y1="7" x2="12" y2="5"/>
      </svg>
    },
    { 
      id: 'delete', 
      label: 'Delete',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
        <circle cx="12" cy="12" r="9"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    },
    { 
      id: 'rotate', 
      label: 'Rotate',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2">
        <path d="M16 4h4v4"/>
        <path d="M16 20h4v-4"/>
        <path d="M4 16l-2-2 2-2"/>
        <path d="M20 16l2-2-2-2"/>
        <path d="M12 12L16 8M16 16L12 12"/>
      </svg>
    },
  ];

  return (
    <div className="tool-panel">
      {tools.map((tool) => (
        <div key={tool.id} className="tool-item">
          <button
            className={`tool-button ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => setActiveTool(tool.id)}
          >
            {tool.icon}
          </button>
          <span className="tool-label">{tool.label}</span>
        </div>
      ))}
    </div>
  );
}
