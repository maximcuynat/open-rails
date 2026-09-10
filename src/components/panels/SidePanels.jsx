import { useState } from 'react';

// Properties Panel
const PropertiesPanel = ({ selectedElement }) => {
  if (!selectedElement) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h3>Properties</h3>
        </div>
        <div className="panel-content">
          <p className="panel-empty">No element selected</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Properties</h3>
      </div>
      <div className="panel-content">
        <div className="property-group">
          <div className="property">
            <label>ID</label>
            <span>{selectedElement.id}</span>
          </div>
          <div className="property">
            <label>Type</label>
            <span>{selectedElement.type}</span>
          </div>
          <div className="property">
            <label>Layer</label>
            <span>{selectedElement.layer || 'Default'}</span>
          </div>
        </div>
        
        {selectedElement.start && selectedElement.end && (
          <div className="property-group">
            <h4>Position</h4>
            <div className="property">
              <label>Start X</label>
              <span>{selectedElement.start.x}</span>
            </div>
            <div className="property">
              <label>Start Y</label>
              <span>{selectedElement.start.y}</span>
            </div>
            <div className="property">
              <label>End X</label>
              <span>{selectedElement.end.x}</span>
            </div>
            <div className="property">
              <label>End Y</label>
              <span>{selectedElement.end.y}</span>
            </div>
            {selectedElement.length && (
              <div className="property">
                <label>Length</label>
                <span>{selectedElement.length}px</span>
              </div>
            )}
          </div>
        )}
        
        {selectedElement.name && (
          <div className="property-group">
            <h4>Identity</h4>
            <div className="property">
              <label>Name</label>
              <input 
                type="text" 
                value={selectedElement.name} 
                onChange={() => {}} 
                className="property-input"
              />
            </div>
          </div>
        )}
        
        <div className="property-group">
          <h4>Appearance</h4>
          <div className="property">
            <label>Color</label>
            <input 
              type="color" 
              value={selectedElement.color || '#000000'} 
              onChange={() => {}} 
              className="property-input"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// Layers Panel
const LayersPanel = ({ layers, onAddLayer, onToggleLayer, onLockLayer, onRenameLayer }) => {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Layers</h3>
        <button className="panel-button" onClick={onAddLayer}>+ Add</button>
      </div>
      <div className="panel-content">
        <ul className="layer-list">
          {layers.map(layer => (
            <li key={layer.id} className="layer-item">
              <input 
                type="checkbox" 
                checked={layer.visible} 
                onChange={() => onToggleLayer(layer.id)}
                className="layer-visibility"
              />
              <input 
                type="text" 
                value={layer.name} 
                onChange={(e) => onRenameLayer(layer.id, e.target.value)}
                className="layer-name"
              />
              <button 
                className={`layer-lock ${layer.locked ? 'locked' : ''}`} 
                onClick={() => onLockLayer(layer.id)}
              >
                {layer.locked ? '🔒' : '🔓'}
              </button>
              <button className="layer-delete" onClick={() => {}}>×</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

// Library Panel
const LibraryPanel = ({ onAddElement }) => {
  const categories = [
    { 
      name: 'Rails', 
      items: [
        { name: 'Straight Rail', type: 'rail-straight' },
        { name: 'Curve Rail', type: 'rail-curve' },
        { name: 'Intersection', type: 'junction' },
      ]
    },
    { 
      name: 'Switches', 
      items: [
        { name: 'Y Switch', type: 'switch-y' },
        { name: 'Triangle Switch', type: 'switch-triangle' },
      ]
    },
    { 
      name: 'Stations', 
      items: [
        { name: 'Small Station', type: 'station-small' },
        { name: 'Large Station', type: 'station-large' },
      ]
    },
    { 
      name: 'Signals', 
      items: [
        { name: 'Red Signal', type: 'signal-red' },
        { name: 'Green Signal', type: 'signal-green' },
      ]
    },
  ];

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Library</h3>
      </div>
      <div className="panel-content">
        {categories.map(category => (
          <div key={category.name} className="library-category">
            <h4>{category.name}</h4>
            <ul className="library-list">
              {category.items.map(item => (
                <li 
                  key={item.name} 
                  className="library-item"
                  onClick={() => onAddElement(item.type)}
                >
                  {item.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};

// Simulation Panel
const SimulationPanel = ({ trains, onStartSimulation, onPauseSimulation, onStopSimulation }) => {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Simulation</h3>
        <div className="simulation-controls">
          <button className="sim-button" onClick={onStartSimulation}>▶</button>
          <button className="sim-button" onClick={onPauseSimulation}>⏸</button>
          <button className="sim-button" onClick={onStopSimulation}>⏹</button>
        </div>
      </div>
      <div className="panel-content">
        <h4>Trains ({trains.length})</h4>
        {trains.length === 0 ? (
          <p className="panel-empty">No trains in simulation</p>
        ) : (
          <ul className="train-list">
            {trains.map(train => (
              <li key={train.id} className="train-item">
                <span>{train.name || `Train ${train.id}`}</span>
                <span>Speed: {train.speed} km/h</span>
                <span>Position: {Math.round(train.position * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
        
        <div className="sim-stats">
          <h4>Statistics</h4>
          <div className="stat-row">
            <span>Total Distance:</span>
            <span>15.2 km</span>
          </div>
          <div className="stat-row">
            <span>Active Trains:</span>
            <span>{trains.filter(t => t.running).length}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function SidePanels({ 
  selectedElement, 
  layers,
  onAddLayer,
  onToggleLayer,
  onLockLayer,
  onRenameLayer,
  onAddElement,
  trains,
  onStartSimulation,
  onPauseSimulation,
  onStopSimulation
}) {
  const [activePanel, setActivePanel] = useState('properties');

  const panels = [
    { id: 'properties', label: 'Properties', icon: '⚙️' },
    { id: 'layers', label: 'Layers', icon: '📄' },
    { id: 'library', label: 'Library', icon: '📚' },
    { id: 'simulation', label: 'Simulation', icon: '▶️' },
  ];

  return (
    <div className="side-panels">
      <div className="panel-tabs">
        {panels.map(panel => (
          <button
            key={panel.id}
            className={`panel-tab ${activePanel === panel.id ? 'active' : ''}`}
            onClick={() => setActivePanel(panel.id)}
          >
            {panel.icon} {panel.label}
          </button>
        ))}
      </div>
      
      <div className="panel-container">
        {activePanel === 'properties' && (
          <PropertiesPanel selectedElement={selectedElement} />
        )}
        {activePanel === 'layers' && (
          <LayersPanel 
            layers={layers} 
            onAddLayer={onAddLayer}
            onToggleLayer={onToggleLayer}
            onLockLayer={onLockLayer}
            onRenameLayer={onRenameLayer}
          />
        )}
        {activePanel === 'library' && (
          <LibraryPanel onAddElement={onAddElement} />
        )}
        {activePanel === 'simulation' && (
          <SimulationPanel 
            trains={trains} 
            onStartSimulation={onStartSimulation}
            onPauseSimulation={onPauseSimulation}
            onStopSimulation={onStopSimulation}
          />
        )}
      </div>
    </div>
  );
}
