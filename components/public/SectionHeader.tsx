import React from 'react';

interface SectionHeaderProps {
  eyebrow?: string;
  eyebrowIcon?: React.ReactNode;
  title: string | React.ReactNode;
  description?: string | React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
  dark?: boolean;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  eyebrow,
  eyebrowIcon,
  title,
  description,
  align = 'center',
  className = '',
  dark = false
}) => {
  const isCenter = align === 'center';

  return (
    <div className={`space-y-4 max-w-3xl ${isCenter ? 'mx-auto text-center' : 'text-left'} ${className}`}>
      {eyebrow && (
        <div className={`inline-flex items-center space-x-2 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
          dark 
            ? 'bg-blue-900/50 border border-blue-500/30 text-blue-300' 
            : 'bg-blue-50 border border-blue-100 text-blue-800'
        }`}>
          {eyebrowIcon}
          <span>{eyebrow}</span>
        </div>
      )}

      <h2 className={`text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-tight ${
        dark ? 'text-white' : 'text-slate-900'
      }`}>
        {title}
      </h2>

      {description && (
        <p className={`text-base sm:text-lg leading-relaxed ${
          dark ? 'text-slate-400' : 'text-slate-600'
        }`}>
          {description}
        </p>
      )}
    </div>
  );
};

export default SectionHeader;
