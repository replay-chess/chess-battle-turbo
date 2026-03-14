"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Mail, Clock, ArrowRight, Twitter, Github, Youtube } from "lucide-react";
import Link from "next/link";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

const faqTeasers = [
  { question: "How do I reset my password?", href: "/help" },
  { question: "Can I import games from Chess.com?", href: "/help" },
  { question: "How does the rating system work?", href: "/help" },
];

const socialLinks = [
  { icon: Twitter, href: "#", label: "Twitter" },
  { icon: Github, href: "#", label: "GitHub" },
  { icon: Youtube, href: "#", label: "YouTube" },
];

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "general",
    message: "",
  });
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, boolean> = {};
    if (!formData.name.trim()) newErrors.name = true;
    if (!formData.email.trim() || !formData.email.includes("@")) newErrors.email = true;
    if (!formData.message.trim()) newErrors.message = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Hero */}
      <section className="relative pt-32 pb-12 sm:pt-40 sm:pb-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center"
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-12 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Contact
              </span>
              <div className="h-px w-12 bg-cb-border-strong" />
            </div>
            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-5xl sm:text-6xl md:text-7xl text-cb-text mb-4"
            >
              Get in Touch
            </h1>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-lg text-cb-text-muted max-w-xl mx-auto"
            >
              Have a question, feedback, or partnership idea? We&apos;d love to hear from you.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="h-px w-full bg-gradient-to-r from-transparent via-cb-border to-transparent" />

      {/* Content */}
      <section className="relative py-16 sm:py-24 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          {/* Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="lg:col-span-7"
          >
            {submitted ? (
              <div className="border border-cb-border p-12 text-center">
                <span className="text-4xl mb-6 block">♔</span>
                <h2
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-3xl text-cb-text mb-4"
                >
                  Message Sent
                </h2>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted"
                >
                  We&apos;ll get back to you within 24 hours. Thanks for reaching out!
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="block text-xs text-cb-text-secondary uppercase tracking-widest mb-2"
                  >
                    Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value });
                      setErrors({ ...errors, name: false });
                    }}
                    className={cn(
                      "w-full bg-cb-hover border px-4 py-3 text-sm text-cb-text",
                      "placeholder:text-cb-text-faint",
                      "focus:outline-none focus:border-cb-border-strong focus:bg-cb-hover",
                      "transition-all duration-300",
                      errors.name ? "border-cb-border-strong" : "border-cb-border"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="block text-xs text-cb-text-secondary uppercase tracking-widest mb-2"
                  >
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => {
                      setFormData({ ...formData, email: e.target.value });
                      setErrors({ ...errors, email: false });
                    }}
                    className={cn(
                      "w-full bg-cb-hover border px-4 py-3 text-sm text-cb-text",
                      "placeholder:text-cb-text-faint",
                      "focus:outline-none focus:border-cb-border-strong focus:bg-cb-hover",
                      "transition-all duration-300",
                      errors.email ? "border-cb-border-strong" : "border-cb-border"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="block text-xs text-cb-text-secondary uppercase tracking-widest mb-2"
                  >
                    Subject
                  </label>
                  <select
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    className={cn(
                      "w-full bg-cb-hover border border-cb-border px-4 py-3 text-sm text-cb-text",
                      "focus:outline-none focus:border-cb-border-strong focus:bg-cb-hover",
                      "transition-all duration-300 appearance-none"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    <option value="general" className="bg-cb-bg">General Inquiry</option>
                    <option value="support" className="bg-cb-bg">Technical Support</option>
                    <option value="billing" className="bg-cb-bg">Billing Question</option>
                    <option value="partnership" className="bg-cb-bg">Partnership</option>
                    <option value="press" className="bg-cb-bg">Press & Media</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="block text-xs text-cb-text-secondary uppercase tracking-widest mb-2"
                  >
                    Message
                  </label>
                  <textarea
                    value={formData.message}
                    onChange={(e) => {
                      setFormData({ ...formData, message: e.target.value });
                      setErrors({ ...errors, message: false });
                    }}
                    rows={6}
                    className={cn(
                      "w-full bg-cb-hover border px-4 py-3 text-sm text-cb-text resize-none",
                      "placeholder:text-cb-text-faint",
                      "focus:outline-none focus:border-cb-border-strong focus:bg-cb-hover",
                      "transition-all duration-300",
                      errors.message ? "border-cb-border-strong" : "border-cb-border"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    placeholder="Tell us how we can help..."
                  />
                </div>

                <button
                  type="submit"
                  className={cn(
                    "group relative overflow-hidden",
                    "px-8 py-3 bg-cb-accent text-cb-accent-fg",
                    "text-sm font-medium",
                    "transition-all duration-300"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <span className="relative flex items-center gap-2 group-hover:text-cb-text transition-colors duration-300">
                    Send Message
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                </button>
              </form>
            )}
          </motion.div>

          {/* Info Panel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-5 lg:border-l lg:border-cb-border lg:pl-16"
          >
            <div className="space-y-10">
              {/* Email */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <Mail className="w-4 h-4 text-cb-text-muted" strokeWidth={1.5} />
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs text-cb-text-secondary uppercase tracking-widest"
                  >
                    Email Us
                  </p>
                </div>
                <a
                  href="mailto:hello@playchess.tech"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-secondary hover:text-cb-text text-sm transition-colors"
                >
                  hello@playchess.tech
                </a>
              </div>

              {/* Response time */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <Clock className="w-4 h-4 text-cb-text-muted" strokeWidth={1.5} />
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs text-cb-text-secondary uppercase tracking-widest"
                  >
                    Response Time
                  </p>
                </div>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text-muted"
                >
                  We typically respond within 24 hours during business days.
                </p>
              </div>

              {/* Social */}
              <div>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-cb-text-secondary uppercase tracking-widest mb-3"
                >
                  Follow Us
                </p>
                <div className="flex items-center gap-2">
                  {socialLinks.map((social) => (
                    <a
                      key={social.label}
                      href={social.href}
                      aria-label={social.label}
                      className={cn(
                        "w-10 h-10 border border-cb-border",
                        "flex items-center justify-center",
                        "hover:border-cb-border-strong hover:bg-cb-accent hover:text-cb-accent-fg",
                        "text-cb-text-muted transition-all duration-300"
                      )}
                    >
                      <social.icon className="w-4 h-4" strokeWidth={1.5} />
                    </a>
                  ))}
                </div>
              </div>

              {/* FAQ Teasers */}
              <div>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-cb-text-secondary uppercase tracking-widest mb-3"
                >
                  Common Questions
                </p>
                <div className="space-y-2">
                  {faqTeasers.map((faq) => (
                    <Link
                      key={faq.question}
                      href={faq.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="group flex items-center gap-2 text-sm text-cb-text-muted hover:text-cb-text-secondary transition-colors"
                    >
                      <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                      {faq.question}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
