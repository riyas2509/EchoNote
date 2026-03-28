
import React, { useState, useEffect } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { AuthStatus } from '../types';

interface LandingNavbarProps {
  onLogin: () => void;
  authStatus?: AuthStatus;
}

const LandingNavbar: React.FC<LandingNavbarProps> = ({ onLogin, authStatus }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isLoggedIn = authStatus === AuthStatus.LOGGED_IN;

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Features', path: '/features' },
    { name: 'Solutions', path: '/solutions' },
    { name: 'Pricing', path: '/pricing' },
    { name: 'Security', path: '/security' },
  ];

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? 'bg-white/80 backdrop-blur-md border-b border-brand-divider/20 py-4' : 'bg-transparent py-4'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <Link 
          to="/"
          className="flex items-center gap-3 cursor-pointer group"
        >
          <img 
            src="/Logo-1.jpg" 
            alt="EchoNote"
            className="h-12 w-auto object-contain"
          />
          <span className="text-xl font-bold text-[#1B2A4E] tracking-tight">
            EchoNote
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center space-x-8">
          {navLinks.map((link) => (
            <NavLink
              key={link.name}
              to={link.path}
              className={({ isActive }) => 
                `text-[14px] font-medium transition-colors ${
                  isActive 
                    ? 'text-brand-primary' 
                    : 'text-brand-secondary hover:text-brand-primary'
                }`
              }
            >
              {link.name}
            </NavLink>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center space-x-4">
          <Link 
            to="/auth"
            className="text-[14px] font-semibold text-brand-primary hover:opacity-70 transition-opacity px-4 py-2"
          >
            Log in
          </Link>
          <Link 
            to="/app"
            className="bg-brand-primary text-white text-[13px] font-bold uppercase tracking-widest px-6 py-3 rounded-lg shadow-xl hover:shadow-2xl hover:-translate-y-0.5 transition-all"
          >
            {isLoggedIn ? 'Dashboard' : 'Start Free'}
          </Link>
        </div>

        {/* Mobile Menu Toggle */}
        <button 
          className="md:hidden text-brand-primary"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-b border-brand-divider/20 overflow-hidden"
          >
            <div className="px-6 py-8 flex flex-col space-y-6">
              {navLinks.map((link) => (
                <NavLink
                  key={link.name}
                  to={link.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) => 
                    `text-left text-lg font-medium ${
                      isActive ? 'text-brand-primary' : 'text-brand-secondary'
                    }`
                  }
                >
                  {link.name}
                </NavLink>
              ))}
              <hr className="border-brand-divider/20" />
              <Link 
                to="/auth"
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-left text-lg font-semibold text-brand-primary"
              >
                Log in
              </Link>
              <Link 
                to="/app"
                onClick={() => setIsMobileMenuOpen(false)}
                className="bg-brand-primary text-white text-center py-4 rounded-lg font-bold uppercase tracking-widest text-[13px]"
              >
                {isLoggedIn ? 'Dashboard' : 'Start Free'}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default LandingNavbar;
