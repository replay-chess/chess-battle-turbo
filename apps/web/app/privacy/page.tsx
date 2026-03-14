"use client";

import { LegalPageLayout } from "../components/LegalPageLayout";

const sections = [
  {
    id: "data-collection",
    title: "1. Data We Collect",
    content: (
      <>
        <p>We collect information you provide directly, as well as data generated through your use of the Platform:</p>
        <p className="text-cb-text-secondary font-medium mt-4 mb-2">Account Information</p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted">
          <li>Name, email address, and username</li>
          <li>Profile information (avatar, bio, country)</li>
          <li>Authentication credentials (managed securely via Clerk)</li>
        </ul>
        <p className="text-cb-text-secondary font-medium mt-4 mb-2">Game Data</p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted">
          <li>Chess games played, moves, and timestamps</li>
          <li>Ratings, rankings, and performance statistics</li>
          <li>Game analysis results and coaching interactions</li>
        </ul>
        <p className="text-cb-text-secondary font-medium mt-4 mb-2">Technical Data</p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted">
          <li>IP address, browser type, and device information</li>
          <li>Usage patterns, session duration, and feature interactions</li>
          <li>Error logs and performance metrics</li>
        </ul>
      </>
    ),
  },
  {
    id: "usage",
    title: "2. How We Use Your Data",
    content: (
      <>
        <p>We use your information to:</p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted">
          <li>Provide, maintain, and improve the Platform</li>
          <li>Match you with opponents and manage game sessions</li>
          <li>Generate AI-powered game analysis and personalized coaching</li>
          <li>Detect cheating and enforce our Fair Play Policy</li>
          <li>Send service notifications and optional marketing communications</li>
          <li>Analyze usage trends to improve user experience</li>
        </ul>
      </>
    ),
  },
  {
    id: "sharing",
    title: "3. Data Sharing",
    content: (
      <>
        <p>We do not sell your personal data. We may share information with:</p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted">
          <li>
            <span className="text-cb-text-secondary">Service Providers:</span> Hosting (Vercel), authentication (Clerk), payment
            processing (Stripe), and analytics providers
          </li>
          <li>
            <span className="text-cb-text-secondary">Chess.com:</span> When you use our import feature, limited data is exchanged
            via their public API
          </li>
          <li>
            <span className="text-cb-text-secondary">Legal Requirements:</span> When required by law, regulation, or legal
            process
          </li>
        </ul>
        <div className="border-l-2 border-cb-border-strong pl-4 bg-cb-hover py-3 mt-4">
          <p className="text-cb-text-secondary">
            All third-party service providers are contractually obligated to protect your data and may only use it for
            the specific purposes we authorize.
          </p>
        </div>
      </>
    ),
  },
  {
    id: "security",
    title: "4. Data Security",
    content: (
      <>
        <p>
          We implement industry-standard security measures to protect your data, including encryption in transit (TLS
          1.3), encryption at rest, and regular security audits.
        </p>
        <p>
          While we strive to protect your information, no method of electronic storage or transmission is 100% secure.
          We cannot guarantee absolute security but are committed to promptly addressing any security incidents.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    title: "5. Your Rights",
    content: (
      <>
        <div className="border-l-2 border-cb-border-strong pl-4 bg-cb-hover py-3">
          <p className="text-cb-text-secondary">
            You have the following rights regarding your personal data, subject to applicable law:
          </p>
        </div>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted mt-4">
          <li>
            <span className="text-cb-text-secondary">Access:</span> Request a copy of the personal data we hold about you
          </li>
          <li>
            <span className="text-cb-text-secondary">Correction:</span> Request correction of inaccurate personal data
          </li>
          <li>
            <span className="text-cb-text-secondary">Deletion:</span> Request deletion of your personal data
          </li>
          <li>
            <span className="text-cb-text-secondary">Portability:</span> Export your game data in PGN format
          </li>
          <li>
            <span className="text-cb-text-secondary">Opt-out:</span> Unsubscribe from marketing communications at any time
          </li>
        </ul>
        <p className="mt-4">
          To exercise any of these rights, contact us at{" "}
          <a
            href="mailto:privacy@playchess.tech"
            className="text-cb-text-secondary hover:text-cb-text underline transition-colors"
          >
            privacy@playchess.tech
          </a>
          . We will respond within 30 days.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "6. Cookies",
    content: (
      <>
        <p>
          We use cookies and similar tracking technologies to enhance your experience. For detailed information about the
          cookies we use, please see our{" "}
          <a href="/cookies" className="text-cb-text-secondary hover:text-cb-text underline transition-colors">
            Cookie Policy
          </a>
          .
        </p>
        <p>
          Essential cookies are required for the Platform to function and cannot be disabled. You may manage your
          preferences for non-essential cookies through your browser settings.
        </p>
      </>
    ),
  },
  {
    id: "third-party",
    title: "7. Third-Party Services",
    content: (
      <>
        <p>The Platform integrates with the following third-party services that may process your data:</p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted">
          <li>
            <span className="text-cb-text-secondary">Clerk</span> — Authentication and user management
          </li>
          <li>
            <span className="text-cb-text-secondary">Stripe</span> — Payment processing
          </li>
          <li>
            <span className="text-cb-text-secondary">Vercel</span> — Hosting and edge computing
          </li>
          <li>
            <span className="text-cb-text-secondary">Chess.com API</span> — Game import functionality
          </li>
        </ul>
        <p className="mt-4">
          Each third-party service has its own privacy policy. We encourage you to review them.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "8. Children's Privacy",
    content: (
      <>
        <p>
          The Platform is not intended for children under 13. We do not knowingly collect personal information from
          children under 13. If we learn that we have collected data from a child under 13, we will take steps to delete
          it promptly.
        </p>
        <p>
          Users between 13 and 18 may use the Platform with parental consent. Parents may contact us to review, modify,
          or delete their child&apos;s information.
        </p>
      </>
    ),
  },
  {
    id: "international",
    title: "9. International Transfers",
    content: (
      <>
        <p>
          Your data may be transferred to and processed in countries other than your country of residence, including the
          United States. These countries may have different data protection laws.
        </p>
        <p>
          We ensure appropriate safeguards are in place for international data transfers, including standard contractual
          clauses approved by relevant authorities.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "10. Changes to This Policy",
    content: (
      <>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes by posting the
          updated policy on the Platform and updating the &quot;Last Updated&quot; date.
        </p>
        <p>
          We encourage you to review this policy periodically. Your continued use of the Platform after changes
          constitutes acceptance of the updated policy.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "11. Contact Us",
    content: (
      <>
        <p>If you have questions about this Privacy Policy or our data practices, contact us:</p>
        <div className="border border-cb-border p-4 mt-4 space-y-2">
          <p className="text-cb-text-secondary">ReplayChess Privacy Team</p>
          <p>
            Email:{" "}
            <a
              href="mailto:privacy@playchess.tech"
              className="text-cb-text-secondary hover:text-cb-text underline transition-colors"
            >
              privacy@playchess.tech
            </a>
          </p>
          <p>Response time: Within 30 business days</p>
        </div>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return <LegalPageLayout title="Privacy Policy" lastUpdated="January 15, 2026" sections={sections} />;
}
