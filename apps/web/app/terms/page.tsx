"use client";

import { LegalPageLayout } from "../components/LegalPageLayout";

const sections = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    content: (
      <>
        <p>
          By accessing or using ReplayChess (&quot;the Platform&quot;), you agree to be bound by these Terms of Service
          (&quot;Terms&quot;). If you do not agree to all of these Terms, you may not access or use the Platform.
        </p>
        <p>
          These Terms constitute a legally binding agreement between you and ReplayChess regarding your use of the
          Platform. We reserve the right to modify these Terms at any time, and such modifications shall be effective
          immediately upon posting.
        </p>
      </>
    ),
  },
  {
    id: "service-description",
    title: "2. Service Description",
    content: (
      <>
        <p>
          ReplayChess is an online chess platform that enables users to play chess games, relive legendary chess
          positions, challenge friends, and analyze games using AI-powered tools. The Platform includes, but is not
          limited to:
        </p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted">
          <li>Real-time multiplayer chess games</li>
          <li>Historical position replay from famous grandmaster games</li>
          <li>AI-powered game analysis and coaching</li>
          <li>Player profiles, ratings, and statistics</li>
          <li>Community features and tournaments</li>
        </ul>
      </>
    ),
  },
  {
    id: "accounts",
    title: "3. User Accounts",
    content: (
      <>
        <p>
          To access certain features of the Platform, you must create an account. You agree to provide accurate,
          current, and complete information during the registration process and to update such information as necessary.
        </p>
        <p>
          You are responsible for safeguarding your account credentials and for all activities that occur under your
          account. You must notify us immediately of any unauthorized use of your account.
        </p>
        <p>
          You must be at least 13 years of age to create an account. If you are under 18, you represent that you have
          your parent or guardian&apos;s permission to use the Platform.
        </p>
      </>
    ),
  },
  {
    id: "user-conduct",
    title: "4. User Conduct",
    content: (
      <>
        <p>You agree not to engage in any of the following activities while using the Platform:</p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted">
          <li>Using chess engines, bots, or external assistance during rated games</li>
          <li>Intentionally disconnecting or stalling to avoid losses</li>
          <li>Creating multiple accounts to manipulate ratings or circumvent bans</li>
          <li>Harassing, threatening, or abusing other users</li>
          <li>Attempting to exploit bugs or vulnerabilities in the Platform</li>
          <li>Distributing spam, malware, or unauthorized commercial content</li>
        </ul>
      </>
    ),
  },
  {
    id: "intellectual-property",
    title: "5. Intellectual Property",
    content: (
      <>
        <p>
          The Platform and its original content, features, and functionality are owned by ReplayChess and are protected
          by international copyright, trademark, patent, trade secret, and other intellectual property laws.
        </p>
        <p>
          Chess move sequences and game notations are not subject to copyright. However, our presentation, analysis,
          commentary, and educational content surrounding these games are proprietary.
        </p>
      </>
    ),
  },
  {
    id: "fair-play",
    title: "6. Fair Play Policy",
    content: (
      <>
        <div className="border-l-2 border-cb-border-strong pl-4 bg-cb-hover py-3">
          <p className="text-cb-text-secondary">
            ReplayChess is committed to maintaining a fair and competitive environment for all players. We employ
            advanced statistical analysis and behavioral detection systems to identify cheating.
          </p>
        </div>
        <p>
          Violations of our Fair Play Policy may result in temporary or permanent account suspension, rating
          adjustments, removal from tournaments, and forfeiture of prizes. Decisions by our Fair Play team are final.
        </p>
        <p>
          Players who are flagged by our detection systems will be reviewed by a human team before any action is taken.
          You may appeal any fair play decision within 30 days by contacting our support team.
        </p>
      </>
    ),
  },
  {
    id: "payments",
    title: "7. Payments & Subscriptions",
    content: (
      <>
        <p>
          Certain features of the Platform require a paid subscription. By subscribing, you agree to pay the applicable
          fees as described on our pricing page. All fees are quoted in US dollars unless otherwise stated.
        </p>
        <p>
          Subscriptions automatically renew at the end of each billing period unless cancelled. You may cancel your
          subscription at any time through your account settings. Cancellation takes effect at the end of the current
          billing period.
        </p>
        <p>
          We offer a 30-day money-back guarantee for new subscriptions. Refund requests after 30 days will be reviewed
          on a case-by-case basis.
        </p>
      </>
    ),
  },
  {
    id: "third-party",
    title: "8. Third-Party Integrations",
    content: (
      <>
        <p>
          The Platform may integrate with third-party services, including Chess.com, for importing games and positions.
          Your use of such integrations is subject to the respective third-party terms of service.
        </p>
        <p>
          ReplayChess is not responsible for the availability, accuracy, or content of third-party services. We do not
          endorse and are not liable for any third-party services accessed through the Platform.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "9. Disclaimers",
    content: (
      <>
        <p>
          The Platform is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, either
          express or implied, including but not limited to implied warranties of merchantability, fitness for a
          particular purpose, and non-infringement.
        </p>
        <p>
          We do not warrant that the Platform will be uninterrupted, secure, or error-free. We do not guarantee the
          accuracy of any AI-generated analysis or coaching recommendations.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "10. Termination",
    content: (
      <>
        <p>
          We may terminate or suspend your account and access to the Platform immediately, without prior notice, for
          conduct that we determine violates these Terms, is harmful to other users, or is otherwise objectionable.
        </p>
        <p>
          Upon termination, your right to use the Platform will immediately cease. You may request a copy of your game
          data within 30 days of termination by contacting support.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "11. Changes to Terms",
    content: (
      <>
        <p>
          We reserve the right to modify or replace these Terms at any time. If a revision is material, we will provide
          at least 30 days notice prior to any new terms taking effect.
        </p>
        <p>
          Your continued use of the Platform after any changes to these Terms constitutes acceptance of the revised
          Terms. We encourage you to review these Terms periodically.
        </p>
      </>
    ),
  },
  {
    id: "governing-law",
    title: "12. Governing Law",
    content: (
      <>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, United
          States, without regard to its conflict of law provisions.
        </p>
        <p>
          Any disputes arising under these Terms shall be resolved through binding arbitration in accordance with the
          rules of the American Arbitration Association. The arbitration shall take place in Wilmington, Delaware.
        </p>
        <p>
          If you have any questions about these Terms, please contact us at{" "}
          <a href="mailto:legal@playchess.tech" className="text-cb-text-secondary hover:text-cb-text underline transition-colors">
            legal@playchess.tech
          </a>
          .
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return <LegalPageLayout title="Terms of Service" lastUpdated="January 15, 2026" sections={sections} />;
}
