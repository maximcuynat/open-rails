import { useState } from 'react';
import './App.css';
import TopBar from './components/layout/TopBar';
import Toolbar from './components/layout/Toolbar';
import CanvasArea from './components/canvas/CanvasArea';
import SidePanels from './components/panels/SidePanels';
import StatusBar from './components/layout/StatusBar';

function App() {
  const [scale, setScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [currentTool, setCurrentTool] = useState('select');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [selectedElement, setSelectedElement] = useState(null);
  const [messages, setMessages] = useState([]);
  
  // Layers state
  const [layers, setLayers] = useState([
    { id: 'layer_1', name: 'Track 1', visible: true, locked: false, opacity: 100 },
    { id: 'layer_2', name: 'Signals', visible: true, locked: false, opacity: 80 },
    { id: 'layer_3', name: 'Stations', visible: true, locked: false, opacity: 100 },
  ]);
  
  // Trains state
  const [trains, setTrains] = useState([]);

  // Handle mouse position tracking
  const handleMouseMove = (e) => {
    const actualX = (e.clientX - panOffset.x) / scale;
    const actualY = (e.clientY - panOffset.y) / scale;
    setMousePosition({ x: actualX, y: actualY });
  };

  // Layer handlers
  const handleAddLayer = () => {
    const newLayer = {
      id: `layer_${Date.now()}`,
      name: `Layer ${layers.length + 1}`,
      visible: true,
      locked: false,
      opacity: 100
    };
    setLayers([...layers, newLayer]);
  };

  const handleToggleLayer = (layerId) => {
    setLayers(layers.map(layer => 
      layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
    ));
  };

  const handleLockLayer = (layerId) => {
    setLayers(layers.map(layer => 
      layer.id === layerId ? { ...layer, locked: !layer.locked } : layer
    ));
  };

  const handleRenameLayer = (layerId, newName) => {
    setLayers(layers.map(layer => 
      layer.id === layerId ? { ...layer, name: newName } : layer
    ));
  };

  // Tool handlers
  const handleToolSelect = (toolId) => {
    setCurrentTool(toolId);
    setMessages([`Tool changed to: ${toolId}`]);
  };

  // Element handlers
  const handleAddElement = (elementType) => {
    setMessages([`Added element: ${elementType}`]);
  };

  // Simulation handlers
  const handleStartSimulation = () => {
    setMessages([`Simulation started`]);
  };

  const handlePauseSimulation = () => {
    setMessages([`Simulation paused`]);
  };

  const handleStopSimulation = () => {
    setMessages([`Simulation stopped`]);
  };

  return (
    <div className="app-container" onMouseMove={handleMouseMove}>
      {/* Top Bar */}
      <TopBar />
      
      {/* Toolbar - Left Side */}
      <Toolbar onToolSelect={handleToolSelect} />
      
      {/* Canvas Area - Center */}
      <CanvasArea 
        scale={scale} 
        panOffset={panOffset} 
        setPanOffset={setPanOffset} 
        showGrid={showGrid} 
        snapToGrid={snapToGrid}
      />
      
      {/* Side Panels - Right Side */}
      <SidePanels 
        selectedElement={selectedElement}
        layers={layers}
        onAddLayer={handleAddLayer}
        onToggleLayer={handleToggleLayer}
        onLockLayer={handleLockLayer}
        onRenameLayer={handleRenameLayer}
        onAddElement={handleAddElement}
        trains={trains}
        onStartSimulation={handleStartSimulation}
        onPauseSimulation={handlePauseSimulation}
        onStopSimulation={handleStopSimulation}
      />
      
      {/* Status Bar - Bottom */}
      <StatusBar 
        currentTool={currentTool} 
        mousePosition={mousePosition} 
        zoomLevel={scale} 
        messages={messages}
      />
    </div>
  );
}

export default App;
