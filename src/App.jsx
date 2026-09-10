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
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e) => {
      if (isDragging) {
        const dx = e.clientX - lastPos.x;
        const dy = e.clientY - lastPos.y;
        setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        setLastPos({ x: e.clientX, y: e.clientY });
        drawGrid();
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      canvas.style.cursor = 'grab';
    };

    const handleMouseLeave = () => {
      if (isDragging) {
        setIsDragging(false);
        canvas.style.cursor = 'grab';
      }
    };

    window.addEventListener('resize', handleResize);
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [gridSize, showGrid, panOffset, isDragging, lastPos]);

  const resetView = () => {
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <div className="d-flex flex-column vh-100">
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark">
        <div className="container-fluid">
          <span className="navbar-brand">
            <i className="bi bi-train-front me-2"></i>
            Train Switch Game
          </span>
          <div className="d-flex">
            <div className="me-3">
              <label htmlFor="gridSize" className="form-label text-white me-2">Grid Size</label>
              <input
                type="range"
                className="form-range"
                min="10"
                max="100"
                step="5"
                value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
                id="gridSize"
              />
              <span className="text-white ms-2">{gridSize}px</span>
            </div>
            <button
              className={`btn ${showGrid ? 'btn-outline-light' : 'btn-outline-secondary'} me-2`}
              onClick={() => setShowGrid(!showGrid)}
            >
              <i className={`bi ${showGrid ? 'bi-grid-fill' : 'bi-grid'}`}></i>
            </button>
            <button className="btn btn-outline-light" onClick={resetView}>
              <i className="bi bi-arrow-clockwise"></i>
            </button>
          </div>
        </div>
      </nav>
      <canvas
        ref={canvasRef}
        style={{ backgroundColor: '#fff', display: 'block', cursor: 'grab', flex: 1 }}
      />
    </div>
  );
}

export default App;
