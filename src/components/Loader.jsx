import React from 'react';

/**
 * Loader — "Rhythm" soft-dark redesign (v4).
 * Public API unchanged (size/color/className/fullScreen).
 * Legacy color names are remapped to the emerald/teal palette.
 */
const Loader = ({
  size = 'md',
  color = 'orange',
  className = '',
  fullScreen = false
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-4',
    lg: 'w-12 h-12 border-4',
    xl: 'w-16 h-16 border-4'
  };

  // Legacy → light palette mapping (prop names kept for compatibility)
  const colorClasses = {
    orange: 'border-emerald-600',
    blue: 'border-cyan-600',
    purple: 'border-purple-600',
    white: 'border-white',
    slate: 'border-slate-400'
  };

  const spinner = (
    <div
      className={`
        rounded-full
        border-t-transparent
        animate-spin
        ${sizeClasses[size] || sizeClasses.md}
        ${colorClasses[color] || colorClasses.orange}
        ${className}
      `}
    />
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
        {spinner}
      </div>
    );
  }

  return spinner;
};

export default Loader;
