import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export interface SeoMetadata {
  title: string;
  description: string;
  canonicalPath?: string;
  structuredData?: Record<string, any>;
  noIndex?: boolean;
}

export const CANONICAL_BASE_URL = 'https://echonote-25.vercel.app';

export const PUBLIC_PAGES_METADATA: Record<string, SeoMetadata> = {
  '/': {
    title: 'EchoNote | Decision & Execution Memory for Coordination-Heavy Teams',
    description: 'EchoNote turns conversations into structured decisions, clear ownership, actionable tasks, and traceable organizational memory for coordination-heavy teams.',
    canonicalPath: '/',
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": "https://echonote-25.vercel.app/#organization",
          "name": "EchoNote",
          "url": "https://echonote-25.vercel.app",
          "logo": "https://echonote-25.vercel.app/Logo-2.png",
          "description": "EchoNote is a decision and execution memory layer for coordination-heavy teams, turning conversations into structured decisions, clear ownership, and traceable organizational memory."
        },
        {
          "@type": "SoftwareApplication",
          "@id": "https://echonote-25.vercel.app/#software",
          "name": "EchoNote",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web Browser",
          "description": "Decision and execution memory platform that turns conversations into structured decisions, task ownership, dependencies, and execution tracking.",
          "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD"
          }
        },
        {
          "@type": "WebSite",
          "@id": "https://echonote-25.vercel.app/#website",
          "url": "https://echonote-25.vercel.app",
          "name": "EchoNote",
          "description": "Decision & Execution Memory for Coordination-Heavy Teams",
          "publisher": {
            "@id": "https://echonote-25.vercel.app/#organization"
          }
        }
      ]
    }
  },
  '/features': {
    title: 'Features — Decision Capture, Task Ownership & Tracking | EchoNote',
    description: 'Explore EchoNote core capabilities: audio-to-transcript capture, decision intelligence extraction, owner accountability, dependency tracking, and cross-project historical search.',
    canonicalPath: '/features',
    structuredData: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "EchoNote Features",
      "applicationCategory": "BusinessApplication",
      "description": "Core capabilities for capturing conversations, extracting decisions, retaining organizational context, tracking execution, and enterprise governance."
    }
  },
  '/solutions': {
    title: 'Solutions — Built for Coordination-Heavy Cross-Functional Teams | EchoNote',
    description: 'Discover how EchoNote maintains context and continuity across meetings for Product & Engineering, Operations, Consulting, and Compliance-sensitive teams.',
    canonicalPath: '/solutions',
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "EchoNote Solutions for Coordination-Heavy Teams",
      "description": "Tailored decision intelligence and organizational memory workflows for Product & Engineering, Operations, Consulting, and Compliance-Sensitive Teams."
    }
  },
  '/pricing': {
    title: 'Pricing — Flexible Plans for Teams of All Sizes | EchoNote',
    description: 'Transparent pricing for EchoNote. Start with our Free starter plan, or upgrade to Pro, Team, or Enterprise for increased minutes, team collaboration, and advanced governance.',
    canonicalPath: '/pricing',
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "EchoNote Subscriptions",
      "description": "Flexible plans for individuals, growing teams, and enterprises needing decision memory and execution tracking."
    }
  },
  '/security': {
    title: 'Security & Data Governance Architecture | EchoNote',
    description: 'Learn about EchoNote enterprise security architecture: Zero-training AI policy, role-based access control (RBAC), multi-factor authentication (MFA), and encrypted cloud infrastructure.',
    canonicalPath: '/security',
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "EchoNote Security & Data Governance Architecture",
      "description": "Comprehensive security architecture, role-based access control, zero-training AI policy, and encryption standards for EchoNote."
    }
  },
  '/contact': {
    title: 'Contact Us — Support & Enterprise Inquiries | EchoNote',
    description: 'Get in touch with the EchoNote team for product demonstrations, technical inquiries, enterprise contracts, or customer support.',
    canonicalPath: '/contact'
  },
  '/demo': {
    title: 'Book an Interactive Product Walkthrough | EchoNote',
    description: 'Schedule a tailored walkthrough of EchoNote to see how conversation ingestion, decision intelligence, and execution tracking can streamline your team operations.',
    canonicalPath: '/demo'
  },
  '/privacy': {
    title: 'Privacy Policy | EchoNote',
    description: 'Read the EchoNote privacy policy, detailing data protection practices, zero-training AI policy, and user privacy guarantees.',
    canonicalPath: '/privacy'
  },
  '/terms': {
    title: 'Terms of Service | EchoNote',
    description: 'Review the terms of service governing access to and usage of the EchoNote decision and execution platform.',
    canonicalPath: '/terms'
  }
};

/**
 * React hook to synchronize document title, meta tags, and structured data
 * safely based on the current location pathname.
 */
export const useDocumentSeo = () => {
  const location = useLocation();

  useEffect(() => {
    const meta = PUBLIC_PAGES_METADATA[location.pathname];
    
    if (meta) {
      document.title = meta.title;

      // Update or create meta description
      let descTag = document.querySelector('meta[name="description"]');
      if (descTag) {
        descTag.setAttribute('content', meta.description);
      }

      // Update canonical link
      let canonicalTag = document.querySelector('link[rel="canonical"]');
      const canonicalHref = `${CANONICAL_BASE_URL}${meta.canonicalPath || location.pathname}`;
      if (canonicalTag) {
        canonicalTag.setAttribute('href', canonicalHref);
      }

      // Update Open Graph tags
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', meta.title);

      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute('content', meta.description);

      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) ogUrl.setAttribute('content', canonicalHref);

      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) ogImage.setAttribute('content', `${CANONICAL_BASE_URL}/og-preview.png`);

      // Update Twitter tags
      const twTitle = document.querySelector('meta[name="twitter:title"]');
      if (twTitle) twTitle.setAttribute('content', meta.title);

      const twDesc = document.querySelector('meta[name="twitter:description"]');
      if (twDesc) twDesc.setAttribute('content', meta.description);

      const twUrl = document.querySelector('meta[name="twitter:url"]');
      if (twUrl) twUrl.setAttribute('content', canonicalHref);

      const twImage = document.querySelector('meta[name="twitter:image"]');
      if (twImage) twImage.setAttribute('content', `${CANONICAL_BASE_URL}/og-preview.png`);

      // Update robots meta tag for public vs private
      let robotsTag = document.querySelector('meta[name="robots"]');
      if (robotsTag) {
        robotsTag.setAttribute('content', 'index, follow');
      }
    } else {
      // Non-public or authenticated route: Protect against indexing
      let robotsTag = document.querySelector('meta[name="robots"]');
      if (!robotsTag) {
        robotsTag = document.createElement('meta');
        robotsTag.setAttribute('name', 'robots');
        document.head.appendChild(robotsTag);
      }
      robotsTag.setAttribute('content', 'noindex, nofollow');
    }
  }, [location.pathname]);
};
