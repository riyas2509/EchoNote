
import React from 'react';
import { motion } from 'motion/react';

const PrivacyPolicy: React.FC = () => {
  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 }
  };

  return (
    <div className="bg-brand-background pt-32 pb-24 px-6">
      <div className="max-w-4xl mx-auto space-y-16">
        <motion.div {...fadeIn} className="space-y-6 text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-brand-primary">Privacy Policy</h1>
          <p className="text-brand-secondary/60 text-lg">Last updated: March 19, 2026</p>
        </motion.div>

        <motion.div {...fadeIn} transition={{ delay: 0.2 }} className="prose prose-slate max-w-none space-y-12 text-brand-secondary/80 leading-relaxed">
          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">1. Information We Collect</h2>
            <p>
              EchoNote ("we," "us," or "our") collects information to provide better services to all our users. The types of information we collect include:
            </p>
            <ul className="list-disc pl-6 space-y-4">
              <li><strong>Personal Information:</strong> Name, email address, and billing information when you create an account.</li>
              <li><strong>Audio Data:</strong> Audio recordings you upload or record live through our platform for transcription purposes.</li>
              <li><strong>Usage Data:</strong> Information about how you interact with our services, including features used and time spent.</li>
              <li><strong>Device Information:</strong> IP address, browser type, and operating system details.</li>
            </ul>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">2. How We Use Your Information</h2>
            <p>We use the collected information for the following purposes:</p>
            <ul className="list-disc pl-6 space-y-4">
              <li>To provide, maintain, and improve our transcription and AI analysis services.</li>
              <li>To process your transactions and manage your subscription.</li>
              <li>To communicate with you about updates, security alerts, and support.</li>
              <li>To ensure compliance with legal obligations and protect against fraudulent activity.</li>
            </ul>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">3. Data Security</h2>
            <p>
              We implement enterprise-grade security measures to protect your data. This includes end-to-end encryption for all audio and transcript data, regular security audits, and strict access controls. Your audio data is processed by our AI models and is not used for training purposes without your explicit consent.
            </p>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">4. Your Rights</h2>
            <p>
              You have the right to access, correct, or delete your personal information at any time. You can also request a copy of your data or object to certain types of processing. To exercise these rights, please contact us at privacy@echonote.ai.
            </p>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">5. Changes to This Policy</h2>
            <p>
              We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
            </p>
          </section>
        </motion.div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
