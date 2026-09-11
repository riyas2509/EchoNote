import React from 'react';
import { Link } from 'react-router-dom';
import BrandWordmark from './public/BrandWordmark';

export const LandingFooter: React.FC = () => {
  const currentYear = new Date().getFullYear();

  const footerNav = [
    {
      title: 'Product',
      links: [
        { name: 'Features', path: '/features' },
        { name: 'Solutions', path: '/solutions' },
        { name: 'Pricing', path: '/pricing' },
        { name: 'Security', path: '/security' },
      ],
    },
    {
      title: 'Company',
      links: [
        { name: 'Book a Demo', path: '/demo' },
        { name: 'Contact Sales & Support', path: '/contact' },
        { name: 'Start Free Trial', path: '/app' },
      ],
    },
    {
      title: 'Legal & Compliance',
      links: [
        { name: 'Privacy Policy', path: '/privacy' },
        { name: 'Terms of Service', path: '/terms' },
        { name: 'Security Architecture', path: '/security' },
      ],
    },
  ];

  return (
    <footer className="bg-slate-950 text-slate-300 pt-20 pb-12 border-t border-slate-900 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-16">
          
          {/* Brand Info & Mission */}
          <div className="lg:col-span-2 space-y-5">
            <Link 
              to="/"
              className="flex items-center gap-2.5 cursor-pointer group w-fit"
            >
              <img 
                src="/Logo-2.png" 
                alt="EchoNote"
                className="h-8 w-auto object-contain"
              />
              <span className="text-white font-extrabold text-xl tracking-tight">
                EchoNote
              </span>
            </Link>
            
            <p className="text-slate-400 max-w-sm text-sm leading-relaxed">
              Decision & Execution Memory for Coordination-Heavy Teams. Turning important conversations into searchable decisions, verified rationale, ownership, and follow-through.
            </p>

            <div className="flex items-center space-x-3 pt-2">
              <a 
                href="https://www.linkedin.com/in/riya-shah-335056290/" 
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit EchoNote LinkedIn profile"
                className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-xs"
              >
                <i className="fa-brands fa-linkedin text-sm"></i>
              </a>
              <a 
                href="https://github.com/riyas2509" 
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit EchoNote GitHub repository"
                className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-xs"
              >
                <i className="fa-brands fa-github text-sm"></i>
              </a>
            </div>
          </div>

          {/* Link Columns */}
          {footerNav.map((col) => (
            <div key={col.title} className="space-y-4">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                {col.title}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.name}>
                    <Link
                      to={link.path}
                      className="text-sm text-slate-400 hover:text-white transition-colors"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        </div>

        <div className="border-t border-slate-900 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {currentYear} EchoNote Inc. All rights reserved.</p>
          <div className="flex items-center space-x-6">
            <Link to="/privacy" className="hover:text-slate-400 transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-slate-400 transition-colors">Terms</Link>
            <Link to="/security" className="hover:text-slate-400 transition-colors">Security</Link>
            <Link to="/contact" className="hover:text-slate-400 transition-colors">Contact</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
