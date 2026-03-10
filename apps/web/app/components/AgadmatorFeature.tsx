"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

export const AgadmatorFeature = () => {
  const [isMuted, setIsMuted] = useState(true);
  const [userPreferredMute, setUserPreferredMute] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const toggleMute = () => {
    if (videoRef.current) {
      const newMuteState = !isMuted;
      videoRef.current.muted = newMuteState;
      setIsMuted(newMuteState);
      setUserPreferredMute(newMuteState);
    }
  };

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            videoElement.muted = true;
            setIsMuted(true);
          } else {
            videoElement.muted = userPreferredMute;
            setIsMuted(userPreferredMute);
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(videoElement);

    return () => {
      observer.disconnect();
    };
  }, [userPreferredMute]);

  return (
    <section className="w-full py-12 sm:py-24 px-6 bg-black relative overflow-hidden">
      {/* Subtle diagonal line pattern */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            white,
            white 1px,
            transparent 1px,
            transparent 60px
          )`,
        }}
      />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8 sm:mb-16"
        >
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-px w-16 bg-white/20" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-[10px] tracking-[0.4em] uppercase"
            >
              Featured Content
            </span>
            <div className="h-px w-16 bg-white/20" />
          </div>

          <h2
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl sm:text-5xl md:text-6xl text-white mb-4"
          >
            Pause the Video
          </h2>

          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-white/40 text-lg max-w-2xl mx-auto"
          >
            Play iconic moments from Agadmator's legendary chess channel
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left Content - Video Card */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            {/* Decorative frame */}
            <div className="absolute -inset-4 border border-white/5" />
            <div className="absolute -inset-8 border border-white/[0.02]" />

            <div className="relative border border-white/10 bg-black">
              {/* Video Preview */}
              <div className="aspect-video relative overflow-hidden group">
                <video
                  ref={videoRef}
                  autoPlay
                  loop
                  muted
                  playsInline
                  poster="/og-image.jpg"
                  className="absolute inset-0 w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
                >
                  <source src="/video_clip.webm" type="video/webm" />
                </video>

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

                {/* Text Overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-4 z-10 flex items-end justify-between">
                  <div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white text-sm font-medium"
                    >
                      Agadmator's Chess Channel
                    </p>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-white/50 text-xs mt-1"
                    >
                      #pause-the-video
                    </p>
                  </div>

                  {/* Audio Toggle */}
                  <button
                    onClick={toggleMute}
                    className={cn(
                      "w-10 h-10 flex items-center justify-center",
                      "border transition-all duration-300",
                      isMuted
                        ? "border-white/20 hover:border-white/40"
                        : "border-white bg-white"
                    )}
                    aria-label={isMuted ? "Unmute video" : "Mute video"}
                  >
                    {isMuted ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="w-4 h-4 text-white"
                      >
                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="w-4 h-4 text-black"
                      >
                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-3 border-t border-white/10">
                {[
                  { label: "Videos", value: "4000+" },
                  { label: "Positions", value: "6000+" },
                  { label: "Players", value: "1M+" },
                ].map((stat, index) => (
                  <div
                    key={index}
                    className={cn(
                      "text-center py-4",
                      index !== 2 && "border-r border-white/10"
                    )}
                  >
                    <p
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-xl text-white"
                    >
                      {stat.value}
                    </p>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-[10px] tracking-[0.2em] uppercase text-white/30 mt-1"
                    >
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Right Content - Text */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            {/* Quote */}
            <div className="border-l-2 border-white/20 pl-6">
              <p
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-2xl sm:text-3xl text-white leading-relaxed italic"
              >
                "Pause the video and try to find the best move"
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-white/40 text-sm mt-4"
              >
                — Every Agadmator video
              </p>
            </div>

            {/* Description */}
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/50 leading-relaxed"
            >
              Love Agadmator's legendary chess content? Now you can play all the
              iconic "pause the video" moments from his channel with your
              friends. Test your tactical vision against the same positions that
              challenge millions of chess fans.
            </p>

            {/* Features */}
            <div className="space-y-4">
              {[
                "Access every pause the video moment",
                "Challenge friends to solve the position",
                "Learn from the best tactical puzzles",
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className="flex items-center gap-4 group"
                >
                  <div className="w-8 h-8 border border-white/10 flex items-center justify-center group-hover:bg-white group-hover:border-white transition-all duration-300">
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-xs text-white/40 group-hover:text-black transition-colors"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-white/70 group-hover:text-white transition-colors"
                  >
                    {feature}
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Channel Badge */}
            <div className="flex items-center gap-4 pt-6 border-t border-white/10">
              <div className="w-12 h-12 bg-white flex items-center justify-center">
                <span className="text-2xl text-black">♔</span>
              </div>
              <div>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="font-medium text-white"
                >
                  Agadmator
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-white/40"
                >
                  World's Most Popular Chess Channel
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
