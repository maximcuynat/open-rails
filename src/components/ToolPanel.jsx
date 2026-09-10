import { useState } from 'react';

export default function ToolPanel() {
  const [activeTool, setActiveTool] = useState('select');

  const tools = [
    { id: 'select', icon: 'bi-cursor-fill', label: 'Select' },
    { id: 'rail-straight', icon: 'bi-road', label: 'Straight Rail' },
    { id: 'rail-curve', icon: 'bi-turn-right', label: 'Curve Rail' },
    { id: 'switch', icon: 'bi-arrow-left-right', label: 'Switch' },
    { id: 'rail-cross', icon: 'bi-plus-circle-fill', label: 'Crossing' },
    { id: 'train', icon: 'bi-train-front-fill', label: 'Train' },
    { id: 'delete', icon: 'bi-trash-fill', label: 'Delete' },
    { id: 'rotate', icon: 'bi-arrow-clockwise', label: 'Rotate' },
  ];

  return (
    <div className="tool-panel">
      {tools.map((tool) => (
        <div key={tool.id} className="tool-item">
          <button
            className={`tool-button ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => setActiveTool(tool.id)}
          >
            <i className={`bi ${tool.icon}`} />
          </button>
          <span className="tool-label">{tool.label}</span>
        </div>
      ))}
    </div>
  );
}
