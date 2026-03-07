"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Navbar } from "@/app/components/Navbar";
import { Plus, Edit2, Save, X, Trash2, Crown, ArrowLeft } from "lucide-react";
import { motion } from "motion/react";

interface Legend {
  id: string;
  referenceId: string;
  name: string;
  era: string;
  profilePhotoUrl: string | null;
  peakRating: number | null;
  nationality: string | null;
  shortDescription: string;
  playingStyle: string | null;
  birthYear: number | null;
  deathYear: number | null;
  achievements: string[] | null;
  famousGames: { fen: string; description?: string }[] | null;
  isActive: boolean;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LegendFormData {
  name: string;
  era: string;
  profilePhotoUrl: string;
  peakRating: string;
  nationality: string;
  shortDescription: string;
  playingStyle: string;
  birthYear: string;
  deathYear: string;
  achievements: string;
  isActive: boolean;
  isVisible: boolean;
}

const initialFormData: LegendFormData = {
  name: "",
  era: "",
  profilePhotoUrl: "",
  peakRating: "",
  nationality: "",
  shortDescription: "",
  playingStyle: "",
  birthYear: "",
  deathYear: "",
  achievements: "",
  isActive: true,
  isVisible: false,
};

export default function LegendsAdmin() {
  const [legends, setLegends] = useState<Legend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<LegendFormData>(initialFormData);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchLegends();
  }, []);

  const fetchLegends = async () => {
    try {
      logger.debug("Fetching legends...");
      const response = await fetch("/api/legends");
      const data = await response.json();
      logger.debug("API Response: " + JSON.stringify(data));
      if (data.success) {
        logger.debug("Setting legends: " + JSON.stringify(data.data.legends));
        setLegends(data.data.legends);
      } else {
        logger.error("API returned unsuccessful:", data);
      }
    } catch (error) {
      logger.error("Error fetching legends:", error);
      toast.error("Failed to fetch legends");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (legend: Legend) => {
    setEditingId(legend.id);
    setFormData({
      name: legend.name,
      era: legend.era,
      profilePhotoUrl: legend.profilePhotoUrl || "",
      peakRating: legend.peakRating?.toString() || "",
      nationality: legend.nationality || "",
      shortDescription: legend.shortDescription,
      playingStyle: legend.playingStyle || "",
      birthYear: legend.birthYear?.toString() || "",
      deathYear: legend.deathYear?.toString() || "",
      achievements: legend.achievements?.join(", ") || "",
      isActive: legend.isActive ?? true,
      isVisible: legend.isVisible ?? false,
    });
    setShowForm(true);
  };

  const handleCreateNew = () => {
    setEditingId(null);
    setFormData(initialFormData);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialFormData);
  };

  const handleDelete = async (legendId: string, legendName: string) => {
    if (!confirm(`Are you sure you want to delete ${legendName}? This will remove the legend and unlink any associated chess positions.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/legends/${legendId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error("Server error response: " + text);
        throw new Error(`Server error: ${response.status} - ${text}`);
      }

      const data = await response.json();

      if (data.success) {
        toast.success(`Legend deleted successfully. ${data.data.deletedLegend.gamesAffected} chess positions were unlinked.`);
        fetchLegends();
      } else {
        logger.error("API Error:", data);
        toast.error(data.error || "Failed to delete legend");
      }
    } catch (error) {
      logger.error("Error deleting legend:", error);
      toast.error(`Failed to delete legend: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const payload = {
        name: formData.name,
        era: formData.era,
        profilePhotoUrl: formData.profilePhotoUrl || null,
        peakRating: formData.peakRating ? parseInt(formData.peakRating) : null,
        nationality: formData.nationality || null,
        shortDescription: formData.shortDescription,
        playingStyle: formData.playingStyle || null,
        birthYear: formData.birthYear ? parseInt(formData.birthYear) : null,
        deathYear: formData.deathYear ? parseInt(formData.deathYear) : null,
        achievements: formData.achievements
          ? formData.achievements.split(",").map((a) => a.trim()).filter(Boolean)
          : null,
        isActive: formData.isActive,
        isVisible: formData.isVisible,
      };

      const url = editingId ? `/api/legends/${editingId}` : "/api/legends/create";
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error("Server error response: " + text);
        throw new Error(`Server error: ${response.status} - ${text}`);
      }

      const data = await response.json();

      if (data.success) {
        toast.success(editingId ? "Legend updated successfully" : "Legend created successfully");
        handleCancel();
        fetchLegends();
      } else {
        logger.error("API Error:", data);
        const errorMsg = data.details
          ? `${data.error}: ${JSON.stringify(data.details)}`
          : data.error;
        toast.error(errorMsg || "Failed to save legend");
      }
    } catch (error) {
      logger.error("Error saving legend:", error);
      toast.error(`Failed to save legend: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black pt-20 md:pt-28 relative">
        {/* Subtle grid background */}
        <div
          className="fixed inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />

        <div className="relative max-w-6xl mx-auto px-4 py-8 z-10">
          {/* Header */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-white/30 to-transparent" />
              <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/50 text-[10px] tracking-[0.4em] uppercase">
                Admin Panel
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-white/30 to-transparent" />
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h1
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-4xl sm:text-5xl text-white mb-2"
                >
                  Manage Legends
                </h1>
                <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm">
                  Add and edit chess legends for the platform
                </p>
              </div>

              {!showForm && (
                <button
                  onClick={handleCreateNew}
                  className="group relative overflow-hidden bg-white text-black px-6 py-3 transition-all duration-300 hover:bg-white/90"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="w-4 h-4" strokeWidth={1.5} />
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="font-medium text-sm tracking-wide">
                      Add Legend
                    </span>
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Back Navigation */}
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 text-white/40 hover:text-white/60 transition-colors mb-8 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" strokeWidth={1.5} />
            <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-sm">
              Back to Dashboard
            </span>
          </Link>

          {/* Separator */}
          <div className="border-t border-white/10 mb-8" />

          {/* Form */}
          {showForm && (
            <div className="mb-12 border border-white/10 p-6 sm:p-8">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 border border-white/20 flex items-center justify-center">
                      <Crown className="w-5 h-5 text-white/60" strokeWidth={1.5} />
                    </div>
                    <div>
                      <h2
                        style={{ fontFamily: "'Instrument Serif', serif" }}
                        className="text-2xl text-white"
                      >
                        {editingId ? "Edit Legend" : "Create New Legend"}
                      </h2>
                      <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm">
                        Fill in the details below
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleCancel}
                    className="w-10 h-10 border border-white/10 flex items-center justify-center hover:border-white/30 hover:bg-white/5 transition-all"
                  >
                    <X className="w-4 h-4 text-white/60" strokeWidth={1.5} />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Name */}
                    <div>
                      <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                        Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-white/10",
                          "text-white placeholder-white/20",
                          "focus:outline-none focus:border-white/30 transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="Magnus Carlsen"
                      />
                    </div>

                    {/* Era */}
                    <div>
                      <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                        Era *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.era}
                        onChange={(e) => setFormData({ ...formData, era: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-white/10",
                          "text-white placeholder-white/20",
                          "focus:outline-none focus:border-white/30 transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="Modern Era"
                      />
                    </div>

                    {/* Profile Photo URL */}
                    <div>
                      <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                        Profile Photo URL
                      </label>
                      <input
                        type="url"
                        value={formData.profilePhotoUrl}
                        onChange={(e) => setFormData({ ...formData, profilePhotoUrl: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-white/10",
                          "text-white placeholder-white/20",
                          "focus:outline-none focus:border-white/30 transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="https://example.com/photo.jpg"
                      />
                    </div>

                    {/* Peak Rating */}
                    <div>
                      <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                        Peak Rating
                      </label>
                      <input
                        type="number"
                        value={formData.peakRating}
                        onChange={(e) => setFormData({ ...formData, peakRating: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-white/10",
                          "text-white placeholder-white/20",
                          "focus:outline-none focus:border-white/30 transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="2882"
                      />
                    </div>

                    {/* Nationality */}
                    <div>
                      <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                        Nationality
                      </label>
                      <input
                        type="text"
                        value={formData.nationality}
                        onChange={(e) => setFormData({ ...formData, nationality: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-white/10",
                          "text-white placeholder-white/20",
                          "focus:outline-none focus:border-white/30 transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="NOR"
                      />
                    </div>

                    {/* Birth Year */}
                    <div>
                      <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                        Birth Year
                      </label>
                      <input
                        type="number"
                        value={formData.birthYear}
                        onChange={(e) => setFormData({ ...formData, birthYear: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-white/10",
                          "text-white placeholder-white/20",
                          "focus:outline-none focus:border-white/30 transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="1990"
                      />
                    </div>

                    {/* Death Year */}
                    <div>
                      <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                        Death Year
                      </label>
                      <input
                        type="number"
                        value={formData.deathYear}
                        onChange={(e) => setFormData({ ...formData, deathYear: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-white/10",
                          "text-white placeholder-white/20",
                          "focus:outline-none focus:border-white/30 transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="Leave empty if alive"
                      />
                    </div>

                    {/* Toggles */}
                    <div className="flex items-center gap-8">
                      {/* Is Active */}
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                        className="flex items-center gap-3 group"
                      >
                        <div className={cn(
                          "w-12 h-6 border relative transition-colors duration-300",
                          formData.isActive ? "border-white bg-white" : "border-white/30"
                        )}>
                          <motion.div
                            animate={{ x: formData.isActive ? 24 : 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            className={cn(
                              "absolute top-0 left-0 w-6 h-full transition-colors duration-300",
                              formData.isActive ? "bg-black" : "bg-white/50"
                            )}
                          />
                        </div>
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-sm text-white/60 group-hover:text-white/80 transition-colors">
                          Active
                        </span>
                      </button>

                      {/* Is Visible */}
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, isVisible: !formData.isVisible })}
                        className="flex items-center gap-3 group"
                      >
                        <div className={cn(
                          "w-12 h-6 border relative transition-colors duration-300",
                          formData.isVisible ? "border-white bg-white" : "border-white/30"
                        )}>
                          <motion.div
                            animate={{ x: formData.isVisible ? 24 : 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            className={cn(
                              "absolute top-0 left-0 w-6 h-full transition-colors duration-300",
                              formData.isVisible ? "bg-black" : "bg-white/50"
                            )}
                          />
                        </div>
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-sm text-white/60 group-hover:text-white/80 transition-colors">
                          Visible on UI
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Short Description */}
                  <div>
                    <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                      Short Description * (max 500 chars)
                    </label>
                    <textarea
                      required
                      value={formData.shortDescription}
                      onChange={(e) => setFormData({ ...formData, shortDescription: e.target.value })}
                      maxLength={500}
                      rows={3}
                      className={cn(
                        "w-full px-4 py-3 bg-transparent border border-white/10",
                        "text-white placeholder-white/20 resize-none",
                        "focus:outline-none focus:border-white/30 transition-colors"
                      )}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      placeholder="Greatest player of all time with exceptional endgame technique"
                    />
                  </div>

                  {/* Playing Style */}
                  <div>
                    <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                      Playing Style
                    </label>
                    <textarea
                      value={formData.playingStyle}
                      onChange={(e) => setFormData({ ...formData, playingStyle: e.target.value })}
                      rows={2}
                      className={cn(
                        "w-full px-4 py-3 bg-transparent border border-white/10",
                        "text-white placeholder-white/20 resize-none",
                        "focus:outline-none focus:border-white/30 transition-colors"
                      )}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      placeholder="Positional mastery with exceptional endgame technique"
                    />
                  </div>

                  {/* Achievements */}
                  <div>
                    <label style={{ fontFamily: "'Geist', sans-serif" }} className="block text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">
                      Achievements (comma-separated)
                    </label>
                    <textarea
                      value={formData.achievements}
                      onChange={(e) => setFormData({ ...formData, achievements: e.target.value })}
                      rows={2}
                      className={cn(
                        "w-full px-4 py-3 bg-transparent border border-white/10",
                        "text-white placeholder-white/20 resize-none",
                        "focus:outline-none focus:border-white/30 transition-colors"
                      )}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      placeholder="5-time World Champion, Longest #1 ranking in history"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-4 pt-4">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className={cn(
                        "group relative overflow-hidden bg-white text-black px-8 py-3 transition-all duration-300",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                    >
                      <motion.div
                        className="absolute inset-0 bg-black origin-left"
                        initial={{ scaleX: 0 }}
                        whileHover={{ scaleX: isSaving ? 0 : 1 }}
                        transition={{ duration: 0.3 }}
                      />
                      <span className="relative flex items-center gap-2 group-hover:text-white transition-colors">
                        <Save className="w-4 h-4" strokeWidth={1.5} />
                        <span style={{ fontFamily: "'Geist', sans-serif" }} className="font-medium text-sm">
                          {isSaving ? "Saving..." : editingId ? "Update Legend" : "Create Legend"}
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCancel}
                      className="px-6 py-3 border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-all"
                      style={{ fontFamily: "'Geist', sans-serif" }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
            </div>
          )}

          {/* Legends List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm">
                  Loading legends...
                </p>
              </div>
            </div>
          ) : legends.length === 0 ? (
            <div className="border border-white/10 p-12 text-center">
              <div className="w-16 h-16 border border-white/20 flex items-center justify-center mx-auto mb-6">
                <Crown className="w-6 h-6 text-white/30" strokeWidth={1.5} />
              </div>
              <h3
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-xl text-white mb-2"
              >
                No legends yet
              </h3>
              <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm mb-6">
                Create your first legend to get started
              </p>
              <button
                onClick={handleCreateNew}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black hover:bg-white/90 transition-colors"
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                <span className="font-medium text-sm">Add Legend</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {legends.map((legend) => (
                <div
                  key={legend.id}
                  className="group border border-white/10 hover:border-white/20 transition-all duration-300"
                >
                  <div className="p-5">
                    <div className="flex items-start gap-4 mb-4">
                      {/* Avatar */}
                      {legend.profilePhotoUrl ? (
                        <Image
                          src={legend.profilePhotoUrl}
                          alt={legend.name}
                          width={48}
                          height={48}
                          className="w-12 h-12 object-cover grayscale group-hover:grayscale-0 transition-all"
                        />
                      ) : (
                        <div className="w-12 h-12 border border-white/20 flex items-center justify-center bg-white/5">
                          <span
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-sm font-medium text-white/60"
                          >
                            {legend.name.split(' ').map(n => n[0]).join('')}
                          </span>
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <h3
                          style={{ fontFamily: "'Instrument Serif', serif" }}
                          className="text-lg text-white truncate"
                        >
                          {legend.name}
                        </h3>
                        <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-xs text-white/40">
                          {legend.era}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEdit(legend)}
                          className="w-8 h-8 border border-white/10 flex items-center justify-center hover:border-white/30 hover:bg-white/5 active:bg-white/10 transition-all"
                          title="Edit legend"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-white/60" strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => handleDelete(legend.id, legend.name)}
                          className="w-8 h-8 border border-white/10 flex items-center justify-center hover:border-red-500/50 hover:bg-red-500/10 active:bg-red-500/20 transition-all"
                          title="Delete legend"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-white/60" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>

                    {/* Description */}
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-white/50 line-clamp-2 mb-4"
                    >
                      {legend.shortDescription}
                    </p>

                    {/* Meta */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {legend.peakRating && (
                          <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-[10px] text-white/30 tracking-wide">
                            Rating: {legend.peakRating}
                          </span>
                        )}
                        {legend.nationality && (
                          <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-[10px] text-white/30 tracking-wide">
                            {legend.nationality}
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <span className={cn(
                          "px-2 py-1 text-[10px] tracking-wide border",
                          legend.isActive
                            ? "border-white/20 text-white/60"
                            : "border-white/10 text-white/30"
                        )} style={{ fontFamily: "'Geist', sans-serif" }}>
                          {legend.isActive ? "Active" : "Inactive"}
                        </span>
                        <span className={cn(
                          "px-2 py-1 text-[10px] tracking-wide border",
                          legend.isVisible
                            ? "border-white bg-white text-black"
                            : "border-white/10 text-white/30"
                        )} style={{ fontFamily: "'Geist', sans-serif" }}>
                          {legend.isVisible ? "Visible" : "Hidden"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Decorative corner elements */}
        <div className="fixed top-20 left-6 w-12 h-12 border-l border-t border-white/10 pointer-events-none" />
        <div className="fixed bottom-6 right-6 w-12 h-12 border-r border-b border-white/10 pointer-events-none" />
      </div>
    </>
  );
}
