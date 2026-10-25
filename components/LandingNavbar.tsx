import React, { useState, useEffect } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, X, ArrowRight } from 'lucide-react';
import { AuthStatus } from '../types';
import BrandWordmark from './public/BrandWordmark';

interface LandingNavbarProps {
  onLogin: () => void;
  onStartFree?: () => void;
  onGoToDashboard?: () => void;
  authStatus?: AuthStatus;
}

export const LandingNavbar: React.FC<LandingNavbarProps> = ({ 
  onLogin, 
  onStartFree, 
  onGoToDashboard, 
  authStatus 
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isLoggedIn = authStatus === AuthStatus.LOGGED_IN;

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 15);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Accessibility: Escape key dismisses mobile menu
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  const navLinks = [
    { name: 'Features', path: '/features' },
    { name: 'Solutions', path: '/solutions' },
    { name: 'Pricing', path: '/pricing' },
    { name: 'Security', path: '/security' },
  ];

  return (
    <nav 
      aria-label="Public Navigation"
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled 
          ? 'bg-white/90 backdrop-blur-md border-b border-slate-200/80 py-3.5 shadow-sm' 
          : 'bg-transparent py-5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        
        {/* LEFT: EchoNote Brand & Logo */}
        <Link 
          to="/"
          className="flex items-center gap-2.5 cursor-pointer group shrink-0"
          aria-label="EchoNote Homepage"
        >
          <img 
            src="/Logo-2.png" 
            alt="EchoNote Logo"
            className="h-8 sm:h-9 w-auto object-contain transition-transform group-hover:scale-105"
          />
          <BrandWordmark size="md" animate={true} />
        </Link>

        {/* CENTER: Navigation Links */}
        <div className="hidden md:flex items-center space-x-1 lg:space-x-2 bg-slate-50/80 border border-slate-200/60 rounded-full px-4 py-1.5 shadow-sm">
          {navLinks.map((link) => (
            <NavLink
              key={link.name}
              to={link.path}
              className={({ isActive }) => 
                `px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all ${
                  isActive 
                    ? 'text-blue-700 bg-white shadow-xs font-bold' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                }`
              }
            >
              {link.name}
            </NavLink>
          ))}
        </div>

        {/* RIGHT: Actions */}
        <div className="hidden md:flex items-center space-x-3">
          <Link 
            to="/auth"
            className="text-[13px] font-bold text-slate-700 hover:text-blue-600 transition-colors px-3 py-2"
          >
            Sign In
          </Link>
          
          {isLoggedIn ? (
            <button 
              id="navbar-dashboard-btn"
              onClick={onGoToDashboard}
              className="bg-brand-primary text-slate-900 text-[12px] font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl shadow-xs hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center gap-1.5"
            >
              <span>Dashboard</span>
              <ArrowRight size={13} />
            </button>
          ) : (
            <button 
              id="navbar-start-free-btn"
              onClick={onStartFree}
              className="bg-brand-primary text-slate-900 text-[12px] font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl shadow-xs hover:bg-blue-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center gap-1.5"
            >
              <span>Get Started</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button 
          className="md:hidden text-slate-800 p-1.5 rounded-lg hover:bg-slate-100"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMobileMenuOpen}
        >
          {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile Dropdown Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden bg-white border-b border-slate-200 overflow-hidden shadow-xl"
          >
            <div className="px-6 py-6 flex flex-col space-y-4">
              {navLinks.map((link) => (
                <NavLink
                  key={link.name}
                  to={link.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) => 
                    `text-left text-base font-bold py-2 border-b border-slate-100 ${
                      isActive ? 'text-blue-600' : 'text-slate-700'
                    }`
                  }
                >
                  {link.name}
                </NavLink>
              ))}
              
              <div className="pt-2 flex flex-col space-y-3">
                <Link 
                  to="/auth"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-center text-sm font-bold text-slate-700 py-2.5 rounded-lg hover:bg-slate-50"
                >
                  Sign In
                </Link>
                
                {isLoggedIn ? (
                  <button 
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onGoToDashboard?.();
                    }}
                    className="bg-brand-primary text-slate-900 text-center py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm"
                  >
                    Go to Dashboard
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onStartFree?.();
                    }}
                    className="bg-brand-primary text-slate-900 text-center py-3.5 rounded-xl font-bold uppercase tracking-wider text-[12px] shadow-sm"
                  >
                    Get Started Free
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default LandingNavbar;
