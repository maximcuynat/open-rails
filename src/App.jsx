import { useRef, useEffect, useState } from 'react';

const DOT_RADIUS = 2;

function App() {
  const canvasRef = useRef(null);
  const [gridSize, setGridSize] = useState(35);
  const [showGrid, setShowGrid] = useState(true);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const drawGrid = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';

      if (showGrid) {
        const startX = panOffset.x % gridSize;
        const startY = panOffset.y % gridSize;

        for (let x = startX; x < canvas.width; x += gridSize) {
          for (let y = startY; y < canvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drawGrid();
    };

    const handleMouseDown = (e) => {
      setIsDragging(true);
      setLastPos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e) => {
      if (isDragging) {
        const dx = e.clientX - lastPos.x;
        const dy = e.clientY - lastPos.y;
        setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        setLastPos({ x: e.clientX, y: e.clientY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [gridSize, showGrid, panOffset, isDragging, lastPos]);

  const resetView = () => {
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <div className="app-container">
      <canvas
        ref={canvasRef}
        className="canvas-main"
      />
      
      <div className="glass-panel">
        <div className="panel-header">
          <i className="bi bi-train-front"></i>
          <span>Train Switch Game</span>
        </div>
        
        <div className="panel-body">
          <div className="control-group">
            <label className="control-label">
              <i className="bi bi-grid-3x3-gap"></i>
              Grid Size
            </label>
            <div className="slider-container">
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
                className="slider"
              />
              <span className="value">{gridSize}px</span>
            </div>
          </div>
          
          <div className="control-group">
            <label className="control-label">
              <i className="bi bi-eye"></i>
              Show Grid
            </label>
            <button
              className={`toggle-btn ${showGrid ? 'active' : ''}`}
              onClick={() => setShowGrid(!showGrid)}
            >
              <i className={`bi ${showGrid ? 'bi-grid-fill' : 'bi-grid'}`}></i>
            </button>
          </div>
          
          <button className="reset-btn" onClick={resetView}>
            <i className="bi bi-arrow-clockwise"></i>
            Reset View
          </button>
        </div>
      </div>
      
      <div className={`drag-overlay ${isDragging ? 'dragging' : ''}`}></div>
    </div>
  );
}

export default App;
