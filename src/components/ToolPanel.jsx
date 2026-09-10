import { useState } from 'react';

export default function ToolPanel() {
  const [activeTool, setActiveTool] = useState('select');

  const tools = [
    { 
      id: 'select', 
      label: 'Select',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 7h.01M17 7h.01M7 17h.01M17 17h.01"/>
        <rect x="7" y="7" width="10" height="10" rx="1"/>
      </svg>
    },
    { 
      id: 'rail-straight', 
      label: 'Straight Rail',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="8" y1="10" x2="8" y2="14"/>
        <line x1="12" y1="10" x2="12" y2="14"/>
        <line x1="16" y1="10" x2="16" y2="14"/>
      </svg>
    },
    { 
      id: 'rail-curve', 
      label: 'Curve Rail',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 4c-4 0-8 4-8 8s4 8 8 8 8-4 8-8-4-8-8-8z"/>
      </svg>
    },
    { 
      id: 'switch', 
      label: 'Switch',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="12" x2="12" y2="12"/>
        <polyline points="12,4 20,12 12,20"/>
      </svg>
    },
    { 
      id: 'rail-cross', 
      label: 'Crossing',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="12" y1="4" x2="12" y2="20"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
    },
    { 
      id: 'train', 
      label: 'Train',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="10" width="16" height="6" rx="1"/>
        <circle cx="8" cy="16" r="1.5"/>
        <circle cx="16" cy="16" r="1.5"/>
      </svg>
    },
    { 
      id: 'delete', 
      label: 'Delete',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3,6 5,6 21,6"/>
        <path d="M19,6 L17,6 L16,8 L18,8 L18,19 L6,19 L6,8 L8,8 L9,6 L7,6"/>
        <line x1="10" y1="11" x2="10" y2="17"/>
        <line x1="14" y1="11" x2="14" y2="17"/>
      </svg>
    },
    { 
      id: 'rotate', 
      label: 'Rotate',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 4h4v4"/>
        <path d="M16 20h4v-4"/>
        <path d="M4 16l-2-2 2-2"/>
        <path d="M20 16l2-2-2-2"/>
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
