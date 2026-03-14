"use client";

import { LegalPageLayout } from "../components/LegalPageLayout";

const sections = [
  {
    id: "what-are-cookies",
    title: "1. What Are Cookies",
    content: (
      <>
        <p>
          Cookies are small text files stored on your device when you visit a website. They help websites remember your
          preferences, understand how you use the site, and improve your experience.
        </p>
        <p>
          ReplayChess uses cookies and similar technologies (such as local storage and session storage) to operate the
          Platform effectively.
        </p>
      </>
    ),
  },
  {
    id: "cookie-categories",
    title: "2. Cookie Categories",
    content: (
      <>
        <p className="mb-4">We use the following categories of cookies:</p>
        <div className="overflow-x-auto border border-cb-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cb-border">
                <th className="p-3 text-left text-cb-text-secondary bg-cb-hover">Category</th>
                <th className="p-3 text-left text-cb-text-secondary bg-cb-hover">Purpose</th>
                <th className="p-3 text-left text-cb-text-secondary bg-cb-hover">Duration</th>
                <th className="p-3 text-left text-cb-text-secondary bg-cb-hover">Required</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-cb-border">
                <td className="p-3 text-cb-text-secondary">Essential</td>
                <td className="p-3">Authentication, session management, security tokens, CSRF protection</td>
                <td className="p-3">Session / 30 days</td>
                <td className="p-3 text-cb-text-secondary">Yes</td>
              </tr>
              <tr className="border-b border-cb-border">
                <td className="p-3 text-cb-text-secondary">Performance</td>
                <td className="p-3">Page load times, error tracking, API response monitoring</td>
                <td className="p-3">1 year</td>
                <td className="p-3 text-cb-text-secondary">No</td>
              </tr>
              <tr className="border-b border-cb-border">
                <td className="p-3 text-cb-text-secondary">Functional</td>
                <td className="p-3">Board theme preferences, sound settings, analysis panel state</td>
                <td className="p-3">1 year</td>
                <td className="p-3 text-cb-text-secondary">No</td>
              </tr>
              <tr>
                <td className="p-3 text-cb-text-secondary">Marketing</td>
                <td className="p-3">Conversion tracking, referral attribution, campaign performance</td>
                <td className="p-3">90 days</td>
                <td className="p-3 text-cb-text-secondary">No</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: "essential-cookies",
    title: "3. Essential Cookies",
    content: (
      <>
        <p>
          These cookies are strictly necessary for the Platform to function. They enable core features such as user
          authentication, game session management, and security. Without these cookies, the Platform cannot operate
          properly.
        </p>
        <div className="border-l-2 border-cb-border-strong pl-4 bg-cb-hover py-3 mt-4">
          <p className="text-cb-text-secondary">
            Essential cookies cannot be disabled. They do not store any personally identifiable information beyond what
            is required for authentication.
          </p>
        </div>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted mt-4">
          <li>
            <span className="text-cb-text-secondary">__clerk_session</span> — Manages authenticated user sessions
          </li>
          <li>
            <span className="text-cb-text-secondary">__csrf_token</span> — Prevents cross-site request forgery attacks
          </li>
          <li>
            <span className="text-cb-text-secondary">game_session</span> — Maintains active game state during play
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "performance-cookies",
    title: "4. Performance Cookies",
    content: (
      <>
        <p>
          Performance cookies help us understand how visitors interact with the Platform by collecting anonymous
          aggregate data. This information helps us identify and fix issues, optimize page load times, and improve
          overall user experience.
        </p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted mt-4">
          <li>Page load and rendering performance metrics</li>
          <li>WebSocket connection stability monitoring</li>
          <li>Error frequency and type tracking</li>
          <li>Feature usage analytics (anonymized)</li>
        </ul>
      </>
    ),
  },
  {
    id: "functional-cookies",
    title: "5. Functional Cookies",
    content: (
      <>
        <p>
          Functional cookies remember your preferences and settings to provide a personalized experience. These cookies
          enhance your use of the Platform but are not strictly necessary.
        </p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted mt-4">
          <li>Chess board theme and piece set preferences</li>
          <li>Sound and notification settings</li>
          <li>Analysis panel layout and configuration</li>
          <li>Language and timezone preferences</li>
        </ul>
      </>
    ),
  },
  {
    id: "marketing-cookies",
    title: "6. Marketing Cookies",
    content: (
      <>
        <p>
          Marketing cookies track visitors across websites to enable us to measure the effectiveness of our advertising
          campaigns. We use minimal marketing tracking and do not sell data to advertisers.
        </p>
        <p>
          These cookies are only set if you arrive via a marketing campaign link. You can opt out at any time through
          your browser settings.
        </p>
      </>
    ),
  },
  {
    id: "managing-cookies",
    title: "7. Managing Cookies",
    content: (
      <>
        <p>
          You can manage or delete cookies through your browser settings. Here&apos;s how to do it in popular browsers:
        </p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted mt-4">
          <li>
            <span className="text-cb-text-secondary">Chrome:</span> Settings → Privacy and Security → Cookies and other site
            data
          </li>
          <li>
            <span className="text-cb-text-secondary">Firefox:</span> Settings → Privacy & Security → Cookies and Site Data
          </li>
          <li>
            <span className="text-cb-text-secondary">Safari:</span> Preferences → Privacy → Manage Website Data
          </li>
          <li>
            <span className="text-cb-text-secondary">Edge:</span> Settings → Cookies and site permissions → Manage and delete
            cookies
          </li>
        </ul>
        <div className="border-l-2 border-cb-border-strong pl-4 bg-cb-hover py-3 mt-4">
          <p className="text-cb-text-secondary">
            Note: Disabling essential cookies will prevent you from using key features of the Platform, including
            logging in and playing games.
          </p>
        </div>
      </>
    ),
  },
  {
    id: "third-party-cookies",
    title: "8. Third-Party Cookies",
    content: (
      <>
        <p>Some cookies are placed by third-party services that appear on our pages:</p>
        <ul className="list-disc list-inside space-y-2 text-cb-text-muted mt-4">
          <li>
            <span className="text-cb-text-secondary">Clerk</span> — Authentication session management
          </li>
          <li>
            <span className="text-cb-text-secondary">Stripe</span> — Payment security and fraud prevention
          </li>
          <li>
            <span className="text-cb-text-secondary">Vercel Analytics</span> — Anonymous performance monitoring
          </li>
        </ul>
        <p className="mt-4">
          These providers set their own cookies subject to their respective privacy policies.
        </p>
      </>
    ),
  },
  {
    id: "updates",
    title: "9. Updates to This Policy",
    content: (
      <>
        <p>
          We may update this Cookie Policy to reflect changes in our practices or for operational, legal, or regulatory
          reasons. Changes will be posted on this page with an updated &quot;Last Updated&quot; date.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "10. Contact",
    content: (
      <>
        <p>
          For questions about our use of cookies, please see our{" "}
          <a href="/privacy" className="text-cb-text-secondary hover:text-cb-text underline transition-colors">
            Privacy Policy
          </a>{" "}
          or contact us at{" "}
          <a
            href="mailto:privacy@playchess.tech"
            className="text-cb-text-secondary hover:text-cb-text underline transition-colors"
          >
            privacy@playchess.tech
          </a>
          .
        </p>
      </>
    ),
  },
];

export default function CookiesPage() {
  return <LegalPageLayout title="Cookie Policy" lastUpdated="January 15, 2026" sections={sections} />;
}
