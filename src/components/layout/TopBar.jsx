import { useState } from 'react';

export default function TopBar() {
  const [activeMenu, setActiveMenu] = useState(null);

  const menus = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'New', action: () => console.log('New project'), shortcut: 'Ctrl+N' },
        { label: 'Open', action: () => console.log('Open project'), shortcut: 'Ctrl+O' },
        { label: 'Save', action: () => console.log('Save project'), shortcut: 'Ctrl+S' },
        { label: 'Save As', action: () => console.log('Save As'), shortcut: 'Ctrl+Shift+S' },
        { type: 'divider' },
        { label: 'Export', action: () => console.log('Export'), items: [
          { label: 'JSON', action: () => console.log('Export JSON') },
          { label: 'DXF', action: () => console.log('Export DXF') },
          { label: 'PDF', action: () => console.log('Export PDF') },
        ] },
        { label: 'Import', action: () => console.log('Import'), shortcut: 'Ctrl+I' },
        { type: 'divider' },
        { label: 'Quit', action: () => console.log('Quit'), shortcut: 'Ctrl+Q' },
      ]
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { label: 'Undo', action: () => console.log('Undo'), shortcut: 'Ctrl+Z' },
        { label: 'Redo', action: () => console.log('Redo'), shortcut: 'Ctrl+Y' },
        { type: 'divider' },
        { label: 'Copy', action: () => console.log('Copy'), shortcut: 'Ctrl+C' },
        { label: 'Paste', action: () => console.log('Paste'), shortcut: 'Ctrl+V' },
        { label: 'Cut', action: () => console.log('Cut'), shortcut: 'Ctrl+X' },
        { label: 'Delete', action: () => console.log('Delete'), shortcut: 'Del' },
        { type: 'divider' },
        { label: 'Select All', action: () => console.log('Select All'), shortcut: 'Ctrl+A' },
        { label: 'Preferences', action: () => console.log('Preferences'), shortcut: 'Ctrl+, ' },
      ]
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { label: 'Zoom In', action: () => console.log('Zoom In'), shortcut: 'Ctrl++' },
        { label: 'Zoom Out', action: () => console.log('Zoom Out'), shortcut: 'Ctrl+-' },
        { label: 'Reset Zoom', action: () => console.log('Reset Zoom'), shortcut: 'Ctrl+0' },
        { type: 'divider' },
        { label: 'Show Grid', action: () => console.log('Toggle Grid'), shortcut: 'Ctrl+G', toggle: true },
        { label: 'Snap to Grid', action: () => console.log('Toggle Snap'), shortcut: 'Ctrl+Shift+G', toggle: true },
        { type: 'divider' },
        { label: '2D View', action: () => console.log('2D View'), toggle: true },
        { label: '3D View', action: () => console.log('3D View'), toggle: true },
      ]
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        { label: 'Validate Network', action: () => console.log('Validate Network'), shortcut: 'Ctrl+Shift+V' },
        { label: 'Optimize Layout', action: () => console.log('Optimize Layout') },
        { label: 'Simulation', action: () => console.log('Simulation'), shortcut: 'Ctrl+Shift+S' },
        { label: 'Capacity Calculation', action: () => console.log('Capacity Calculation') },
      ]
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { label: 'Documentation', action: () => console.log('Documentation') },
        { label: 'Tutorials', action: () => console.log('Tutorials') },
        { label: 'Keyboard Shortcuts', action: () => console.log('Keyboard Shortcuts'), shortcut: 'Ctrl+?' },
        { type: 'divider' },
        { label: 'About', action: () => console.log('About') },
      ]
    }
  ];

  const toggleMenu = (menuId) => {
    setActiveMenu(activeMenu === menuId ? null : menuId);
  };

  const closeMenu = () => {
    setActiveMenu(null);
  };

  const renderMenuItem = (item, index) => {
    if (item.type === 'divider') {
      return <li key={`divider-${index}`} className="menu-divider" role="separator"></li>;
    }

    if (item.items) {
      return (
        <li key={item.label} className="menu-item-submenu">
          <span className="menu-label">{item.label}</span>
          <ul className="submenu">
            {item.items.map(renderMenuItem)}
          </ul>
        </li>
      );
    }

    return (
      <li key={item.label} className="menu-item" onClick={() => { item.action(); closeMenu(); }}>
        <span className="menu-label">{item.label}</span>
        {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
        {item.toggle && <span className="menu-toggle"></span>}
      </li>
    );
  };

  return (
    <div className="top-bar">
      <div className="logo">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#000" strokeWidth="2">
          <circle cx="16" cy="16" r="14"/>
          <path d="M8 16h16M16 8v16"/>
        </svg>
        <span>Open Rails</span>
      </div>
      
      <nav className="menu-bar">
        {menus.map(menu => (
          <div key={menu.id} className="menu-dropdown" onMouseLeave={closeMenu}>
            <button 
              className={`menu-button ${activeMenu === menu.id ? 'active' : ''}`}
              onClick={() => toggleMenu(menu.id)}
            >
              {menu.label}
            </button>
            {activeMenu === menu.id && (
              <ul className="menu-dropdown-content">
                {menu.items.map((item, index) => renderMenuItem(item, index))}
              </ul>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}
