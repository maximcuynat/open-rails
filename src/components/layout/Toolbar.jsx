import { useState } from 'react';

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
      </svg>;
    case 'curve':
      return <svg {...iconProps}>
        <path d="M8 12 C8 8 12 8 16 8"/>
        <path d="M8 16 C8 20 12 20 16 16"/>
      </svg>;
    case 'crossing':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="12" y1="4" x2="12" y2="20"/>
      </svg>;
    case 'switch':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="14" y2="12"/>
        <line x1="14" y1="12" x2="20" y2="8"/>
        <line x1="14" y1="12" x2="20" y2="16"/>
      </svg>;
    case 'station':
      return <svg {...iconProps}>
        <rect x="8" y="8" width="8" height="8"/>
        <line x1="4" y1="12" x2="8" y2="12"/>
        <line x1="16" y1="12" x2="20" y2="12"/>
      </svg>;
    case 'signal':
      return <svg {...iconProps}>
        <line x1="12" y1="4" x2="12" y2="20"/>
        <circle cx="12" cy="8" r="2"/>
      </svg>;
    case 'multi-track':
      return <svg {...iconProps}>
        <line x1="4" y1="8" x2="20" y2="8"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="4" y1="16" x2="20" y2="16"/>
      </svg>;
    case 'rotate':
      return <svg {...iconProps}>
        <path d="M12 4 L16 8 L12 12"/>
        <path d="M12 12 L8 8 L12 4"/>
        <path d="M12 20 L16 16 L12 12"/>
        <path d="M12 12 L8 16 L12 20"/>
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
        <line x1="4" y1="12" x2="10" y2="12"/>
        <line x1="14" y1="12" x2="20" y2="12"/>
        <line x1="10" y1="12" x2="14" y2="12"/>
      </svg>;
    case 'split':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
      </svg>;
    case 'merge':
      return <svg {...iconProps}>
        <line x1="4" y1="12" x2="10" y2="12"/>
        <line x1="14" y1="12" x2="20" y2="12"/>
        <line x1="8" y1="10" x2="16" y2="10"/>
        <line x1="8" y1="14" x2="16" y2="14"/>
      </svg>;
    case 'angle':
      return <svg {...iconProps}>
        <line x1="12" y1="4" x2="12" y2="12"/>
        <line x1="12" y1="12" x2="20" y2="12"/>
        <path d="M8 14 L12 12 L8 10"/>
      </svg>;
    case 'terrain':
      return <svg {...iconProps}>
        <line x1="4" y1="20" x2="8" y2="16"/>
        <line x1="8" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="12" x2="16" y2="8"/>
        <line x1="16" y1="8" x2="20" y2="12"/>
      </svg>;
    case 'layers':
      return <svg {...iconProps}>
        <rect x="4" y="8" width="16" height="2"/>
        <rect x="4" y="12" width="16" height="2"/>
        <rect x="4" y="16" width="16" height="2"/>
      </svg>;
    case 'play':
      return <svg {...iconProps}>
        <polygon points="6,6 6,18 16,12"/>
      </svg>;
    case 'pause':
      return <svg {...iconProps}>
        <rect x="8" y="6" width="3" height="12"/>
        <rect x="13" y="6" width="3" height="12"/>
      </svg>;
    case 'stop':
      return <svg {...iconProps}>
        <rect x="8" y="8" width="8" height="8"/>
      </svg>;
    case 'train':
      return <svg {...iconProps}>
        <rect x="6" y="10" width="12" height="4"/>
        <circle cx="8" cy="14" r="1"/>
        <circle cx="16" cy="14" r="1"/>
        <path d="M8 10 L16 10"/>
      </svg>;
    case 'fast':
      return <svg {...iconProps}>
        <polygon points="6,6 6,18 12,12"/>
        <line x1="14" y1="6" x2="20" y2="12"/>
        <line x1="14" y1="18" x2="20" y2="12"/>
      </svg>;
    case 'stats':
      return <svg {...iconProps}>
        <rect x="6" y="6" width="2" height="12"/>
        <rect x="10" y="8" width="2" height="10"/>
        <rect x="14" y="10" width="2" height="8"/>
        <rect x="18" y="12" width="2" height="6"/>
      </svg>;
    default:
      return <svg {...iconProps}>
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="6" x2="12" y2="18"/>
        <line x1="6" y1="12" x2="18" y2="12"/>
      </svg>;
  }
};

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
