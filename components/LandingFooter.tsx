
import React from 'react';
import { Link } from 'react-router-dom';

const LandingFooter: React.FC = () => {
  const currentYear = new Date().getFullYear();

  const footerLinks = [
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
        { name: 'About Us', path: '/' },
        { name: 'Contact', path: '/contact' },
        { name: 'Start Free', path: '/app' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { name: 'Privacy Policy', path: '/privacy' },
        { name: 'Terms of Service', path: '/terms' },
      ],
    },
  ];

  return (
    <footer className="bg-slate-950 text-slate-300 pt-24 pb-12 border-t border-slate-900">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-20">
          {/* Brand Info */}
          <div className="lg:col-span-2 space-y-6">
            <Link 
              to="/"
              className="flex items-center gap-3 mb-4 cursor-pointer group w-fit"
            >
              <img 
                src="/Logo-2.png" 
                alt="EchoNote"
                className="h-10 w-auto object-contain"
              />
              <span className="text-white font-semibold text-lg hover:text-blue-400 transition-colors">
                EchoNote
              </span>
            </Link>
            <p className="text-slate-400 max-w-sm text-[14px] leading-relaxed">
              EchoNote is a premium AI audio intelligence platform designed for enterprise compliance, legal, and financial teams.
            </p>
            <div className="flex items-center space-x-3">
              {[
                {
                  name: 'LinkedIn',
                  icon: 'fa-brands fa-linkedin',
                  url: 'https://www.linkedin.com/in/riya-shah-335056290/',
                  label: 'Visit LinkedIn profile'
                },
                {
                  name: 'GitHub',
                  icon: 'fa-brands fa-github',
                  url: 'https://github.com/riyas2509',
                  label: 'Visit GitHub profile'
                }
              ].map((social) => (
                <a 
                  key={social.name}
                  href={social.url} 
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800/80 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
                >
                  <i className={social.icon}></i>
                </a>
              ))}
            </div>
          </div>

          {/* Link Columns */}
          {footerLinks.map((column) => (
            <div key={column.title} className="space-y-6">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{column.title}</h4>
              <ul className="space-y-4">
                {column.links.map((link) => (
                  <li key={link.name}>
                    <Link
                      to={link.path}
                      className="text-[14px] text-slate-400 hover:text-white transition-colors"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <hr className="border-slate-900 mb-12" />

        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-[13px] text-slate-500">
          <p>© {currentYear} EchoNote Inc. All rights reserved.</p>
          <div className="flex items-center space-x-8">
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link to="/security" className="hover:text-white transition-colors">Security</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
