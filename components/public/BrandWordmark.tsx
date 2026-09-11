import React, { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface BrandWordmarkProps {
  className?: string;
  animate?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const BrandWordmark: React.FC<BrandWordmarkProps> = ({ 
  className = '', 
  animate = true,
  size = 'md'
}) => {
  const shouldReduceMotion = useReducedMotion();
  const fullText = "EchoNote";
  const [displayText, setDisplayText] = useState(shouldReduceMotion || !animate ? fullText : "");
  const [isDone, setIsDone] = useState(shouldReduceMotion || !animate);

  useEffect(() => {
    if (shouldReduceMotion || !animate) {
      setDisplayText(fullText);
      setIsDone(true);
      return;
    }

    // Run brand animation once: E -> Ec -> Echo -> EchoN -> EchoNo -> EchoNot -> EchoNote
    let currentIdx = 0;
    const interval = setInterval(() => {
      currentIdx++;
      if (currentIdx <= fullText.length) {
        setDisplayText(fullText.slice(0, currentIdx));
      } else {
        clearInterval(interval);
        setIsDone(true);
      }
    }, 70);

    return () => clearInterval(interval);
  }, [shouldReduceMotion, animate]);

  const sizeClasses = {
    sm: 'text-base font-bold',
    md: 'text-xl font-bold tracking-tight',
    lg: 'text-2xl font-extrabold tracking-tight',
    xl: 'text-3xl sm:text-4xl font-extrabold tracking-tight'
  };

  return (
    <span className={`inline-flex items-center text-[#1B2A4E] ${sizeClasses[size]} ${className}`}>
      <span>{displayText}</span>
      {!isDone && (
        <motion.span 
          initial={{ opacity: 1 }}
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.6, repeat: Infinity }}
          className="inline-block w-0.5 h-4 sm:h-5 bg-blue-500 ml-0.5 rounded-sm"
        />
      )}
    </span>
  );
};

export default BrandWordmark;
