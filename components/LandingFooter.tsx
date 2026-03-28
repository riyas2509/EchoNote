
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
    <footer className="bg-brand-primary text-white pt-24 pb-12 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-20">
          {/* Brand Info */}
          <div className="lg:col-span-2 space-y-6">
            <Link 
              to="/"
              className="flex items-center gap-3 mb-4 cursor-pointer group w-fit"
            >
              <img 
                src="/Logo-1.jpg" 
                alt="EchoNote"
                className="h-10 w-auto object-contain"
              />
              <span className="text-white font-semibold text-lg">
                EchoNote
              </span>
            </Link>
            <p className="text-white/60 max-w-sm text-[15px] leading-relaxed">
              EchoNote is a premium AI audio intelligence platform designed for enterprise compliance, legal, and financial teams.
            </p>
            <div className="flex items-center space-x-4">
              <a href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                <i className="fa-brands fa-twitter"></i>
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                <i className="fa-brands fa-linkedin"></i>
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                <i className="fa-brands fa-github"></i>
              </a>
            </div>
          </div>

          {/* Link Columns */}
          {footerLinks.map((column) => (
            <div key={column.title} className="space-y-6">
              <h4 className="text-[14px] font-bold uppercase tracking-widest text-white/40">{column.title}</h4>
              <ul className="space-y-4">
                {column.links.map((link) => (
                  <li key={link.name}>
                    <Link
                      to={link.path}
                      className="text-[15px] text-white/60 hover:text-white transition-colors"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <hr className="border-white/10 mb-12" />

        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-[14px] text-white/40">
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
