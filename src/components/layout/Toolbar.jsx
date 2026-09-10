import { useState } from 'react';

// Basic Tools Tab
const BasicTools = ({ onToolSelect }) => {
  const tools = [
    { id: 'rail-straight', label: 'Rail droit', icon: 'straight', shortcut: 'R' },
    { id: 'rail-curve', label: 'Courbe', icon: 'curve', shortcut: 'C' },
    { id: 'junction', label: 'Intersection', icon: 'crossing', shortcut: 'I' },
    { id: 'switch', label: 'Aiguillage', icon: 'switch', shortcut: 'A' },
    { id: 'station', label: 'Gare', icon: 'station', shortcut: 'G' },
    { id: 'signal', label: 'Signal', icon: 'signal', shortcut: 'S' },
    { id: 'multi-track', label: 'Voie multiple', icon: 'multi-track', shortcut: 'M' },
    { id: 'rotate', label: 'Rotation', icon: 'rotate', shortcut: 'T' },
  ];

  return (
    <div className="tool-tab">
      {tools.map(tool => (
        <button 
          key={tool.id}
          className="tool-button"
          onClick={() => onToolSelect(tool.id)}
          title={`${tool.label} (${tool.shortcut})`}
        >
          <ToolIcon type={tool.icon} />
          <span className="tool-label">{tool.shortcut}</span>
        </button>
      ))}
    </div>
  );
};

// Advanced Tools Tab
const AdvancedTools = ({ onToolSelect }) => {
  const tools = [
    { id: 'ruler', label: 'Règle', icon: 'ruler', shortcut: '' },
    { id: 'auto-connect', label: 'Connexion auto', icon: 'connect', shortcut: '' },
    { id: 'split-rail', label: 'Découper rail', icon: 'split', shortcut: '' },
    { id: 'merge-rail', label: 'Fusionner rails', icon: 'merge', shortcut: '' },
    { id: 'angle', label: 'Angle', icon: 'angle', shortcut: '' },
    { id: 'terrain', label: 'Terrain', icon: 'terrain', shortcut: '' },
    { id: 'layers', label: 'Calques', icon: 'layers', shortcut: '' },
  ];

  return (
    <div className="tool-tab">
      {tools.map(tool => (
        <button 
          key={tool.id}
          className="tool-button"
          onClick={() => onToolSelect(tool.id)}
          title={tool.label}
        >
          <ToolIcon type={tool.icon} />
          {tool.shortcut && <span className="tool-label">{tool.shortcut}</span>}
        </button>
      ))}
    </div>
  );
};

// Simulation Tools Tab
const SimulationTools = ({ onToolSelect }) => {
  const tools = [
    { id: 'sim-start', label: 'Démarrer', icon: 'play', shortcut: '' },
    { id: 'sim-pause', label: 'Pause', icon: 'pause', shortcut: '' },
    { id: 'sim-stop', label: 'Arrêter', icon: 'stop', shortcut: '' },
    { id: 'add-train', label: 'Ajouter train', icon: 'train', shortcut: '' },
    { id: 'fast-forward', label: 'Mode rapide', icon: 'fast', shortcut: '' },
    { id: 'stats', label: 'Statistiques', icon: 'stats', shortcut: '' },
  ];

  return (
    <div className="tool-tab">
      {tools.map(tool => (
        <button 
          key={tool.id}
          className="tool-button"
          onClick={() => onToolSelect(tool.id)}
          title={tool.label}
        >
          <ToolIcon type={tool.icon} />
          {tool.shortcut && <span className="tool-label">{tool.shortcut}</span>}
        </button>
      ))}
    </div>
  );
};

// Custom Icon Component
const ToolIcon = ({ type, size = 24 }) => {
  const iconProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#000000",
    strokeWidth: "2"
  };

  switch (type) {
    case 'straight':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="7" y1="10" x2="7" y2="14"/>
        <line x1="10" y1="10" x2="10" y2="14"/>
        <line x1="13" y1="10" x2="13" y2="14"/>
        <line x1="16" y1="10" x2="16" y2="14"/>
        <line x1="19" y1="10" x2="19" y2="14"/>
      </svg>;
    case 'curve':
      return <svg {...iconProps}>
        <path d="M4 12c0-4 4-8 8-8s8 4 8 8"/>
        <line x1="8" y1="10" x2="8" y2="14"/>
        <line x1="12" y1="10" x2="12" y2="14"/>
        <line x1="16" y1="10" x2="16" y2="14"/>
      </svg>;
    case 'crossing':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="12" y1="4" x2="12" y2="20"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>;
    case 'switch':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="10" y2="12"/>
        <line x1="14" y1="12" x2="20" y2="12"/>
        <path d="M10 12 L14 8 L14 16 Z"/>
      </svg>;
    case 'station':
      return <svg {...iconProps}>
        <circle cx="12" cy="12" r="8"/>
        <rect x="6" y="10" width="12" height="4" rx="1"/>
        <circle cx="12" cy="8" r="1"/>
      </svg>;
    case 'signal':
      return <svg {...iconProps}>
        <line x1="12" y1="20" x2="12" y2="14"/>
        <circle cx="12" cy="12" r="3"/>
        <line x1="12" y1="9" x2="12" y2="6"/>
      </svg>;
    case 'multi-track':
      return <svg {...iconProps}>
        <line x1="4" y1="8" x2="20" y2="8"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="4" y1="16" x2="20" y2="16"/>
      </svg>;
    case 'rotate':
      return <svg {...iconProps}>
        <path d="M16 4h4v4"/>
        <path d="M16 20h4v-4"/>
        <path d="M4 16l-2-2 2-2"/>
        <path d="M20 16l2-2-2-2"/>
        <path d="M12 12L16 8M16 16L12 12"/>
      </svg>;
    case 'ruler':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="8" y1="8" x2="8" y2="16"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
        <line x1="16" y1="8" x2="16" y2="16"/>
      </svg>;
    case 'connect':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="8" y2="12"/>
        <line x1="16" y1="12" x2="20" y2="12"/>
        <path d="M8 12 Q12 8 16 12"/>
      </svg>;
    case 'split':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <path d="M12 4 L12 12 L8 12"/>
      </svg>;
    case 'merge':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="8" y2="12"/>
        <line x1="16" y1="12" x2="20" y2="12"/>
        <path d="M8 12 L12 12 L12 8"/>
      </svg>;
    case 'angle':
      return <svg {...iconProps}>
        <line x1="12" y1="4" x2="12" y2="12"/>
        <line x1="12" y1="12" x2="18" y2="18"/>
        <path d="M10 14 L12 12 L10 10"/>
      </svg>;
    case 'terrain':
      return <svg {...iconProps}>
        <path d="M4 20 L8 16 L12 12 L16 8 L20 12 L20 20 Z"/>
        <line x1="6" y1="18" x2="18" y2="18"/>
      </svg>;
    case 'layers':
      return <svg {...iconProps}>
        <rect x="4" y="8" width="16" height="8" rx="1"/>
        <rect x="8" y="4" width="12" height="8" rx="1"/>
        <rect x="12" y="12" width="8" height="8" rx="1"/>
      </svg>;
    case 'play':
      return <svg {...iconProps}>
        <polygon points="6,4 20,12 6,20"/>
      </svg>;
    case 'pause':
      return <svg {...iconProps}>
        <rect x="6" y="4" width="4" height="16" rx="1"/>
        <rect x="14" y="4" width="4" height="16" rx="1"/>
      </svg>;
    case 'stop':
      return <svg {...iconProps}>
        <rect x="6" y="6" width="12" height="12" rx="1"/>
      </svg>;
    case 'train':
      return <svg {...iconProps}>
        <rect x="3" y="10" width="18" height="7" rx="2"/>
        <circle cx="7" cy="17" r="1.5"/>
        <circle cx="17" cy="17" r="1.5"/>
        <path d="M7 10V8a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>
        <line x1="12" y1="7" x2="12" y2="5"/>
      </svg>;
    case 'fast':
      return <svg {...iconProps}>
        <polygon points="6,4 14,12 6,20"/>
        <line x1="16" y1="4" x2="22" y2="12"/>
        <line x1="16" y1="20" x2="22" y2="12"/>
      </svg>;
    case 'stats':
      return <svg {...iconProps}>
        <rect x="4" y="4" width="4" height="16"/>
        <rect x="10" y="8" width="4" height="12"/>
        <rect x="16" y="12" width="4" height="8"/>
      </svg>;
    default:
      return <svg {...iconProps}>
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="6" x2="12" y2="18"/>
        <line x1="6" y1="12" x2="18" y2="12"/>
      </svg>;
  }
};

export default function Toolbar({ onToolSelect }) {
  const [activeTab, setActiveTab] = useState('basic');

  const tabs = [
    { id: 'basic', label: 'Basic', component: <BasicTools onToolSelect={onToolSelect} /> },
    { id: 'advanced', label: 'Advanced', component: <AdvancedTools onToolSelect={onToolSelect} /> },
    { id: 'simulation', label: 'Simulation', component: <SimulationTools onToolSelect={onToolSelect} /> },
  ];

  return (
    <div className="toolbar">
      <div className="toolbar-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`toolbar-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      <div className="toolbar-content">
        {tabs.find(tab => tab.id === activeTab)?.component}
      </div>
    </div>
  );
}
