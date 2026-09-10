import { useState } from 'react';

export default function BottomDrawer() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDrawer = () => setIsOpen(!isOpen);

  return (
    <div className="bottom-drawer-container">
      <div className={`bottom-drawer ${isOpen ? 'open' : ''}`} onClick={toggleDrawer}>
        <div className="drawer-handle">
          <div className="handle-contour">
            <svg
              className="handle-chevron"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#121212"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        </div>
        <div className="drawer-content">
          <div className="fake-rail-grid">
            <div className="fake-rail"></div>
            <div className="fake-rail"></div>
            <div className="fake-rail"></div>
            <div className="fake-rail"></div>
            <div className="fake-rail"></div>
            <div className="fake-rail"></div>
          </div>
        </div>
      </div>
    </div>
  );
}


