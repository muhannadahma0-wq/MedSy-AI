import React from 'react';
import Loader from './Loader';

/**
 * Shared Button — "Rhythm" soft-dark redesign (v4).
 * Deep-emerald primary on white cards; same public API as the original
 * component (variant/isLoading/className/...) so every existing call site
 * keeps working unchanged.
 */
const Button = ({
    children,
    isLoading = false,
    disabled = false,
    className = '',
    variant = 'primary',
    type = 'button',
    onClick,
    ...props
}) => {
    const baseClasses = "relative inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";

    const variants = {
        primary: "bg-emerald-700 hover:bg-emerald-600 text-white shadow-[0_6px_18px_-4px_rgba(4,120,87,0.5)] hover:shadow-[0_10px_26px_-6px_rgba(4,120,87,0.6)]",
        secondary: "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 shadow-sm",
        outline: "bg-transparent border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-400 hover:bg-slate-50",
        danger: "bg-red-600 hover:bg-red-500 text-white shadow-sm hover:shadow-md",
        success: "bg-emerald-700 hover:bg-emerald-600 text-white shadow-[0_6px_18px_-4px_rgba(4,120,87,0.5)]",
        ghost: "bg-transparent hover:bg-slate-100 text-slate-500 hover:text-slate-900",
        dark: "bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-slate-200"
    };

    const sizeClasses = "px-6 py-3"; // Default padding, can be overridden by className

    return (
        <button
            type={type}
            className={`${baseClasses} ${variants[variant] || variants.primary} ${sizeClasses} ${className}`}
            disabled={disabled || isLoading}
            onClick={onClick}
            {...props}
        >
            {isLoading && (
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <Loader size="sm" color="white" />
                </span>
            )}
            <span className={`flex items-center gap-2 ${isLoading ? 'invisible' : ''}`}>
                {children}
            </span>
        </button>
    );
};

export default Button;
