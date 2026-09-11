import React from 'react';

interface ProductWindowProps {
  children: React.ReactNode;
  title?: string;
  badge?: string;
  footerText?: string;
  footerId?: string;
  className?: string;
  headerRight?: React.ReactNode;
}

export const ProductWindow: React.FC<ProductWindowProps> = ({
  children,
  title = "echonote://workspace/decisions",
  badge = "Decision Intelligence",
  footerText = "Permanent Record: Synced to Organizational Memory",
  footerId,
  className = "",
  headerRight
}) => {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200/90 shadow-xl overflow-hidden ${className}`}>
      {/* Window Header */}
      <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between text-white">
        <div className="flex items-center space-x-2">
          <div className="flex space-x-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></div>
          </div>
          <span className="text-xs font-mono text-slate-400 pl-2 select-none truncate max-w-[200px] sm:max-w-none">
            {title}
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          {headerRight || (
            badge && (
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30 text-[10px] sm:text-xs">
                {badge}
              </span>
            )
          )}
        </div>
      </div>

      {/* Content Body */}
      <div className="p-4 sm:p-6 bg-white">
        {children}
      </div>

      {/* Window Footer Status Bar */}
      {(footerText || footerId) && (
        <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span className="truncate">{footerText}</span>
          </span>
          {footerId && (
            <span className="font-mono text-[10px] text-slate-400 shrink-0 ml-2">{footerId}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductWindow;
