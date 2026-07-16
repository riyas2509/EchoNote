
import React from 'react';
import { motion } from 'motion/react';

const TermsOfService: React.FC = () => {
  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 }
  };

  return (
    <div className="bg-brand-background pt-32 pb-24 px-6">
      <div className="max-w-4xl mx-auto space-y-16">
        <motion.div {...fadeIn} className="space-y-6 text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-brand-primary">Terms of Service</h1>
          <p className="text-brand-secondary/60 text-lg">Last updated: March 19, 2026</p>
        </motion.div>

        <motion.div {...fadeIn} transition={{ delay: 0.2 }} className="prose prose-slate max-w-none space-y-12 text-brand-secondary/80 leading-relaxed">
          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">1. Acceptance of Terms</h2>
            <p>
              By accessing or using EchoNote ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use the Service.
            </p>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">2. Use of the Service</h2>
            <p>You are responsible for your use of the Service and for any content you provide. You agree not to use the Service for any illegal or unauthorized purpose.</p>
            <ul className="list-disc pl-6 space-y-4">
              <li><strong>Account Security:</strong> You are responsible for maintaining the confidentiality of your account credentials.</li>
              <li><strong>Prohibited Content:</strong> You may not upload content that is illegal, harmful, or violates the rights of others.</li>
              <li><strong>Usage Limits:</strong> Your use of the Service is subject to the limits of your subscription plan.</li>
            </ul>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">3. Subscriptions and Payments</h2>
            <p>
              EchoNote offers various subscription tiers. By subscribing, you agree to pay the fees associated with your chosen plan. Fees are non-refundable except as required by law.
            </p>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">4. Intellectual Property</h2>
            <p>
              The Service and its original content, features, and functionality are and will remain the exclusive property of EchoNote. Your content remains your property, but you grant us a license to use it solely for the purpose of providing the Service.
            </p>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">5. Limitation of Liability</h2>
            <p>
              EchoNote shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the Service.
            </p>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-brand-primary">6. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which EchoNote is headquartered, without regard to its conflict of law provisions.
            </p>
          </section>
        </motion.div>
      </div>
    </div>
  );
};

export default TermsOfService;
