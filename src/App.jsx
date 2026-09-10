import { useState } from 'react';
import './App.css';
import CanvasGrid from './components/CanvasGrid';
import GridSelector from './components/GridSelector';

function App() {
  const [gridSize, setGridSize] = useState(35);
  const [scale, setScale] = useState(1);

  const handleWheel = (e) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.5, Math.min(3, prev * delta)));
  };

  return (
    <div className="app-container">
      <CanvasGrid
        gridSize={gridSize}
        scale={scale}
        onWheel={handleWheel}
      />
      <GridSelector
        value={gridSize}
        onChange={setGridSize}
      />
    </div>
  );
}

export default App;
