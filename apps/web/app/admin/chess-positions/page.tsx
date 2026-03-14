"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Navbar } from "@/app/components/Navbar";
import ChessBoard from "@/app/components/ChessBoard";
import { Chess } from "chess.js";
import { motion } from "motion/react";
import {
  Plus,
  Edit2,
  Save,
  X,
  Trash2,
  Crown,
  AlertCircle,
  Search,
  ChevronDown,
  Star,
  ArrowLeft,
} from "lucide-react";

// Types
interface Legend {
  id: string;
  referenceId: string;
  name: string;
  era: string;
  profilePhotoUrl: string | null;
}

interface ChessPosition {
  id: string;
  referenceId: string;
  fen: string;
  sideToMove: string;
  pgn: string | null;
  moveNumber: number | null;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  whitePlayerMetadata: Record<string, unknown> | null;
  blackPlayerMetadata: Record<string, unknown> | null;
  whitePlayerId: string | null;
  blackPlayerId: string | null;
  whiteLegend: Legend | null;
  blackLegend: Legend | null;
  tournamentName: string | null;
  eventDate: string | null;
  gameMetadata: Record<string, unknown> | null;
  positionType: string | null;
  positionContext: Record<string, unknown> | null;
  sourceType: string;
  sourceMetadata: Record<string, unknown> | null;
  featured: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ChessPositionFormData {
  fen: string;
  sideToMove: "white" | "black" | "";
  pgn: string;
  moveNumber: string;
  whitePlayerName: string;
  blackPlayerName: string;
  whitePlayerMetadata: string;
  blackPlayerMetadata: string;
  tournamentName: string;
  eventDate: string;
  gameMetadata: string;
  positionType: string;
  positionContext: string;
  sourceType: string;
  sourceMetadata: string;
  featured: boolean;
  isActive: boolean;
}

interface FormErrors {
  fen?: string;
  sideToMove?: string;
  moveNumber?: string;
  whitePlayerMetadata?: string;
  blackPlayerMetadata?: string;
  gameMetadata?: string;
  positionContext?: string;
  sourceMetadata?: string;
  eventDate?: string;
  general?: string;
}

const initialFormData: ChessPositionFormData = {
  fen: "",
  sideToMove: "",
  pgn: "",
  moveNumber: "",
  whitePlayerName: "",
  blackPlayerName: "",
  whitePlayerMetadata: "",
  blackPlayerMetadata: "",
  tournamentName: "",
  eventDate: "",
  gameMetadata: "",
  positionType: "",
  positionContext: "",
  sourceType: "admin",
  sourceMetadata: "",
  featured: false,
  isActive: true,
};

// Legend Search Dropdown Component
function LegendSearchDropdown({
  label,
  selectedLegend,
  onSelect,
  onClear,
}: {
  label: string;
  selectedLegend: Legend | null;
  onSelect: (legend: Legend) => void;
  onClear: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Legend[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/legends/search?name=${encodeURIComponent(query)}`
      );
      const data = await response.json();
      if (data.success) {
        setSearchResults(data.data.legends);
      }
    } catch (error) {
      logger.error("Error searching legends:", error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      handleSearch(searchQuery);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, handleSearch]);

  return (
    <div ref={dropdownRef} className="relative">
      <label
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
      >
        {label}
      </label>

      {selectedLegend ? (
        <div className="flex items-center gap-3 px-4 py-3 border border-cb-border-strong bg-cb-hover">
          {selectedLegend.profilePhotoUrl ? (
            <Image
              src={selectedLegend.profilePhotoUrl}
              alt={selectedLegend.name}
              width={32}
              height={32}
              className="w-8 h-8 object-cover"
            />
          ) : (
            <div className="w-8 h-8 border border-cb-border-strong flex items-center justify-center bg-cb-hover">
              <span className="text-xs text-cb-text-secondary">
                {selectedLegend.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-cb-text truncate"
            >
              {selectedLegend.name}
            </p>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs text-cb-text-muted"
            >
              {selectedLegend.era}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="w-6 h-6 flex items-center justify-center hover:bg-cb-surface-elevated transition-colors"
          >
            <X className="w-4 h-4 text-cb-text-secondary" strokeWidth={1.5} />
          </button>
        </div>
      ) : (
        <div>
          <div
            onClick={() => setIsOpen(true)}
            className={cn(
              "w-full px-4 py-3 border cursor-pointer flex items-center gap-2",
              isOpen ? "border-cb-text-muted" : "border-cb-border",
              "hover:border-cb-border-strong transition-colors"
            )}
          >
            <Search className="w-4 h-4 text-cb-text-muted" strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsOpen(true)}
              placeholder="Search legends..."
              className="flex-1 bg-transparent text-cb-text placeholder-cb-text-muted focus:outline-none"
              style={{ fontFamily: "'Geist', sans-serif" }}
            />
            <ChevronDown
              className={cn(
                "w-4 h-4 text-cb-text-muted transition-transform",
                isOpen && "rotate-180"
              )}
              strokeWidth={1.5}
            />
          </div>

          {isOpen && (
            <div className="absolute z-50 w-full mt-1 border border-cb-border bg-cb-bg max-h-60 overflow-y-auto">
              {isSearching ? (
                <div className="px-4 py-6 text-center">
                  <div className="w-6 h-6 border border-cb-border-strong border-t-cb-text rounded-full animate-spin mx-auto" />
                </div>
              ) : searchResults.length > 0 ? (
                searchResults.map((legend) => (
                  <button
                    key={legend.id}
                    type="button"
                    onClick={() => {
                      onSelect(legend);
                      setIsOpen(false);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-cb-hover transition-colors text-left"
                  >
                    {legend.profilePhotoUrl ? (
                      <Image
                        src={legend.profilePhotoUrl}
                        alt={legend.name}
                        width={32}
                        height={32}
                        className="w-8 h-8 object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 border border-cb-border-strong flex items-center justify-center bg-cb-hover">
                        <span className="text-xs text-cb-text-secondary">
                          {legend.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm text-cb-text truncate"
                      >
                        {legend.name}
                      </p>
                      <p
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-xs text-cb-text-muted"
                      >
                        {legend.era}
                      </p>
                    </div>
                  </button>
                ))
              ) : searchQuery.trim() ? (
                <div className="px-4 py-6 text-center">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-cb-text-muted"
                  >
                    No legends found
                  </p>
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-cb-text-muted"
                  >
                    Type to search legends
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Custom Side to Move Dropdown Component
function SideToMoveDropdown({
  value,
  onChange,
  error,
}: {
  value: "white" | "black" | "";
  onChange: (value: "white" | "black" | "") => void;
  error?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const options = [
    { value: "white" as const, label: "White", icon: <div className="w-3 h-3 rounded-full bg-white border border-cb-text-muted" /> },
    { value: "black" as const, label: "Black", icon: <div className="w-3 h-3 rounded-full bg-black border border-cb-text-muted" /> },
  ];

  const selectedOption = options.find((opt) => opt.value === value);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} className="relative">
      <label
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
      >
        Side to Move *
      </label>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full px-4 py-3 border flex items-center justify-between transition-colors",
          error ? "border-red-500/50" : isOpen ? "border-cb-text-muted" : "border-cb-border",
          "hover:border-cb-border-strong"
        )}
      >
        <div className="flex items-center gap-3">
          {selectedOption ? (
            <>
              {selectedOption.icon}
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text"
              >
                {selectedOption.label}
              </span>
            </>
          ) : (
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted"
            >
              Select side...
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-cb-text-muted transition-transform",
            isOpen && "rotate-180"
          )}
          strokeWidth={1.5}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 border border-cb-border bg-cb-bg">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={cn(
                "w-full px-4 py-3 flex items-center gap-3 transition-colors text-left",
                value === option.value
                  ? "bg-cb-surface-elevated"
                  : "hover:bg-cb-hover"
              )}
            >
              {option.icon}
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text"
              >
                {option.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
}

export default function ChessPositionsAdmin() {
  const [positions, setPositions] = useState<ChessPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] =
    useState<ChessPositionFormData>(initialFormData);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // FEN validation state
  const [fenValid, setFenValid] = useState(false);
  const [previewBoard, setPreviewBoard] = useState<ReturnType<
    Chess["board"]
  > | null>(null);

  // Legend selection state
  const [selectedWhiteLegend, setSelectedWhiteLegend] = useState<Legend | null>(
    null
  );
  const [selectedBlackLegend, setSelectedBlackLegend] = useState<Legend | null>(
    null
  );

  useEffect(() => {
    fetchPositions();
  }, []);

  // FEN validation effect
  useEffect(() => {
    if (!formData.fen.trim()) {
      setFenValid(false);
      setPreviewBoard(null);
      if (errors.fen === "Invalid FEN string") {
        setErrors((prev) => ({ ...prev, fen: undefined }));
      }
      return;
    }

    try {
      const chess = new Chess(formData.fen);
      setFenValid(true);
      setPreviewBoard(chess.board());
      setErrors((prev) => ({ ...prev, fen: undefined }));

      // Auto-set side to move from FEN
      const fenParts = formData.fen.split(" ");
      if (fenParts.length >= 2) {
        const sideFromFen = fenParts[1] === "w" ? "white" : "black";
        if (formData.sideToMove !== sideFromFen) {
          setFormData((prev) => ({ ...prev, sideToMove: sideFromFen }));
        }
      }
    } catch {
      setFenValid(false);
      setPreviewBoard(null);
    }
  }, [formData.fen, formData.sideToMove, errors.fen]);

  const fetchPositions = async () => {
    try {
      const response = await fetch("/api/chess-positions");
      const data = await response.json();
      if (data.success) {
        setPositions(data.data.positions);
      } else {
        logger.error("API returned unsuccessful:", data);
      }
    } catch (error) {
      logger.error("Error fetching positions:", error);
      toast.error("Failed to fetch chess positions");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (position: ChessPosition) => {
    setEditingId(position.referenceId);
    setFormData({
      fen: position.fen,
      sideToMove: position.sideToMove as "white" | "black",
      pgn: position.pgn || "",
      moveNumber: position.moveNumber?.toString() || "",
      whitePlayerName: position.whitePlayerName || "",
      blackPlayerName: position.blackPlayerName || "",
      whitePlayerMetadata: position.whitePlayerMetadata
        ? JSON.stringify(position.whitePlayerMetadata, null, 2)
        : "",
      blackPlayerMetadata: position.blackPlayerMetadata
        ? JSON.stringify(position.blackPlayerMetadata, null, 2)
        : "",
      tournamentName: position.tournamentName || "",
      eventDate: position.eventDate
        ? new Date(position.eventDate).toISOString().slice(0, 16)
        : "",
      gameMetadata: position.gameMetadata
        ? JSON.stringify(position.gameMetadata, null, 2)
        : "",
      positionType: position.positionType || "",
      positionContext: position.positionContext
        ? JSON.stringify(position.positionContext, null, 2)
        : "",
      sourceType: position.sourceType,
      sourceMetadata: position.sourceMetadata
        ? JSON.stringify(position.sourceMetadata, null, 2)
        : "",
      featured: position.featured,
      isActive: position.isActive,
    });
    setSelectedWhiteLegend(position.whiteLegend);
    setSelectedBlackLegend(position.blackLegend);
    setShowForm(true);
  };

  const handleCreateNew = () => {
    setEditingId(null);
    setFormData(initialFormData);
    setSelectedWhiteLegend(null);
    setSelectedBlackLegend(null);
    setErrors({});
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(initialFormData);
    setSelectedWhiteLegend(null);
    setSelectedBlackLegend(null);
    setErrors({});
    setFenValid(false);
    setPreviewBoard(null);
  };

  const handleDelete = async (positionId: string, fen: string) => {
    if (
      !confirm(
        `Are you sure you want to delete this chess position?\n\nFEN: ${fen.substring(0, 50)}...`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/chess-positions/${positionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error: ${response.status} - ${text}`);
      }

      const data = await response.json();

      if (data.success) {
        toast.success("Chess position deleted successfully");
        fetchPositions();
      } else {
        toast.error(data.error || "Failed to delete position");
      }
    } catch (error) {
      logger.error("Error deleting position:", error);
      toast.error(
        `Failed to delete position: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Required: FEN
    if (!formData.fen.trim()) {
      newErrors.fen = "FEN is required";
    } else {
      try {
        new Chess(formData.fen);
      } catch {
        newErrors.fen = "Invalid FEN string";
      }
    }

    // Required: Side to Move
    if (!formData.sideToMove) {
      newErrors.sideToMove = "Side to move is required";
    }

    // Optional: Move Number (must be positive if provided)
    if (formData.moveNumber && parseInt(formData.moveNumber) <= 0) {
      newErrors.moveNumber = "Move number must be positive";
    }

    // JSON field validation
    const jsonFields: { key: keyof FormErrors; value: string }[] = [
      { key: "whitePlayerMetadata", value: formData.whitePlayerMetadata },
      { key: "blackPlayerMetadata", value: formData.blackPlayerMetadata },
      { key: "gameMetadata", value: formData.gameMetadata },
      { key: "positionContext", value: formData.positionContext },
      { key: "sourceMetadata", value: formData.sourceMetadata },
    ];

    jsonFields.forEach(({ key, value }) => {
      if (value && value.trim()) {
        try {
          JSON.parse(value);
        } catch {
          newErrors[key] = "Invalid JSON format";
        }
      }
    });

    // Date validation
    if (formData.eventDate && isNaN(Date.parse(formData.eventDate))) {
      newErrors.eventDate = "Invalid date format";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSaving(true);
    setErrors({});

    try {
      const payload: Record<string, unknown> = {
        fen: formData.fen,
        sideToMove: formData.sideToMove,
        pgn: formData.pgn || null,
        moveNumber: formData.moveNumber ? parseInt(formData.moveNumber) : null,
        whitePlayerName: formData.whitePlayerName || null,
        blackPlayerName: formData.blackPlayerName || null,
        whitePlayerMetadata: formData.whitePlayerMetadata
          ? JSON.parse(formData.whitePlayerMetadata)
          : null,
        blackPlayerMetadata: formData.blackPlayerMetadata
          ? JSON.parse(formData.blackPlayerMetadata)
          : null,
        whitePlayerId: selectedWhiteLegend?.referenceId || null,
        blackPlayerId: selectedBlackLegend?.referenceId || null,
        tournamentName: formData.tournamentName || null,
        eventDate: formData.eventDate
          ? new Date(formData.eventDate).toISOString()
          : null,
        gameMetadata: formData.gameMetadata
          ? JSON.parse(formData.gameMetadata)
          : null,
        positionType: formData.positionType || null,
        positionContext: formData.positionContext
          ? JSON.parse(formData.positionContext)
          : null,
        sourceType: formData.sourceType || "admin",
        sourceMetadata: formData.sourceMetadata
          ? JSON.parse(formData.sourceMetadata)
          : null,
        featured: formData.featured,
        isActive: formData.isActive,
      };

      const url = editingId
        ? `/api/chess-positions/${editingId}`
        : "/api/chess-positions/create";
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error: ${response.status} - ${text}`);
      }

      const data = await response.json();

      if (data.success) {
        toast.success(
          editingId
            ? "Chess position updated successfully"
            : "Chess position created successfully"
        );
        handleCancel();
        fetchPositions();
      } else {
        if (data.details && Array.isArray(data.details)) {
          const apiErrors: FormErrors = {};
          data.details.forEach(
            (err: { field: string; message: string }) => {
              apiErrors[err.field as keyof FormErrors] = err.message;
            }
          );
          setErrors(apiErrors);
        } else {
          setErrors({ general: data.error || "Failed to save position" });
        }
      }
    } catch (error) {
      logger.error("Error saving position:", error);
      setErrors({
        general: `Failed to save position: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to get board preview for position card
  const getBoardForPosition = (fen: string) => {
    try {
      return new Chess(fen).board();
    } catch {
      return null;
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-cb-bg pt-20 md:pt-28 relative">
        {/* Subtle grid background */}
        <div
          className="fixed inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-6xl mx-auto px-4 py-8 z-10">
          {/* Header */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-cb-text-muted to-transparent" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-secondary text-[10px] tracking-[0.4em] uppercase"
              >
                Admin Panel
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-cb-text-muted to-transparent" />
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h1
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-4xl sm:text-5xl text-cb-text mb-2"
                >
                  Chess Positions
                </h1>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted text-sm"
                >
                  Create and manage chess positions for the platform
                </p>
              </div>

              {!showForm && (
                <button
                  onClick={handleCreateNew}
                  className="group relative overflow-hidden bg-cb-accent text-cb-accent-fg px-6 py-3 transition-all duration-300 hover:opacity-90"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="w-4 h-4" strokeWidth={1.5} />
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="font-medium text-sm tracking-wide"
                    >
                      Add Position
                    </span>
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Back Navigation */}
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 text-cb-text-muted hover:text-cb-text-secondary transition-colors mb-8 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" strokeWidth={1.5} />
            <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-sm">
              Back to Dashboard
            </span>
          </Link>

          {/* Separator */}
          <div className="border-t border-cb-border mb-8" />

          {/* Form */}
          {showForm && (
            <div className="mb-12 border border-cb-border p-6 sm:p-8">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 border border-cb-border-strong flex items-center justify-center">
                    <Crown
                      className="w-5 h-5 text-cb-text-secondary"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div>
                    <h2
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-2xl text-cb-text"
                    >
                      {editingId ? "Edit Position" : "Create New Position"}
                    </h2>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-cb-text-muted text-sm"
                    >
                      Fill in the details below
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCancel}
                  className="w-10 h-10 border border-cb-border flex items-center justify-center hover:border-cb-text-muted hover:bg-cb-hover transition-all"
                >
                  <X className="w-4 h-4 text-cb-text-secondary" strokeWidth={1.5} />
                </button>
              </div>

              {/* General Error */}
              {errors.general && (
                <div className="mb-6 p-4 border border-red-500/30 bg-red-500/10">
                  <p className="text-sm text-red-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {errors.general}
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Core Position Section */}
                <div>
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs tracking-[0.3em] uppercase text-cb-text-secondary mb-4"
                  >
                    Core Position
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-6">
                      {/* FEN */}
                      <div>
                        <label
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                        >
                          FEN *
                        </label>
                        <input
                          type="text"
                          required
                          value={formData.fen}
                          onChange={(e) => {
                            setFormData({ ...formData, fen: e.target.value });
                            if (errors.fen)
                              setErrors({ ...errors, fen: undefined });
                          }}
                          className={cn(
                            "w-full px-4 py-3 bg-transparent border",
                            errors.fen
                              ? "border-red-500/50 focus:border-red-500/70"
                              : fenValid
                                ? "border-green-500/50 focus:border-green-500/70"
                                : "border-cb-border focus:border-cb-text-muted",
                            "text-cb-text placeholder-cb-text-faint",
                            "focus:outline-none transition-colors"
                          )}
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                        />
                        {errors.fen && (
                          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {errors.fen}
                          </p>
                        )}
                      </div>

                      {/* Side to Move - Custom Dropdown */}
                      <SideToMoveDropdown
                        value={formData.sideToMove}
                        onChange={(value) => {
                          setFormData({ ...formData, sideToMove: value });
                          if (errors.sideToMove)
                            setErrors({ ...errors, sideToMove: undefined });
                        }}
                        error={errors.sideToMove}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        {/* Move Number */}
                        <div>
                          <label
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                          >
                            Move Number
                          </label>
                          <input
                            type="number"
                            value={formData.moveNumber}
                            onChange={(e) => {
                              setFormData({
                                ...formData,
                                moveNumber: e.target.value,
                              });
                              if (errors.moveNumber)
                                setErrors({ ...errors, moveNumber: undefined });
                            }}
                            className={cn(
                              "w-full px-4 py-3 bg-transparent border",
                              errors.moveNumber
                                ? "border-red-500/50"
                                : "border-cb-border",
                              "text-cb-text placeholder-cb-text-faint",
                              "focus:outline-none focus:border-cb-text-muted transition-colors"
                            )}
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            placeholder="1"
                            min="1"
                          />
                          {errors.moveNumber && (
                            <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {errors.moveNumber}
                            </p>
                          )}
                        </div>

                        {/* Position Type */}
                        <div>
                          <label
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                          >
                            Position Type
                          </label>
                          <input
                            type="text"
                            value={formData.positionType}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                positionType: e.target.value,
                              })
                            }
                            className={cn(
                              "w-full px-4 py-3 bg-transparent border border-cb-border",
                              "text-cb-text placeholder-cb-text-faint",
                              "focus:outline-none focus:border-cb-text-muted transition-colors"
                            )}
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            placeholder="opening, middlegame, endgame"
                          />
                        </div>
                      </div>

                      {/* PGN */}
                      <div>
                        <label
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                        >
                          PGN
                        </label>
                        <textarea
                          value={formData.pgn}
                          onChange={(e) =>
                            setFormData({ ...formData, pgn: e.target.value })
                          }
                          rows={3}
                          className={cn(
                            "w-full px-4 py-3 bg-transparent border border-cb-border",
                            "text-cb-text placeholder-cb-text-faint resize-none",
                            "focus:outline-none focus:border-cb-text-muted transition-colors"
                          )}
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          placeholder="1. e4 e5 2. Nf3 Nc6..."
                        />
                      </div>
                    </div>

                    {/* FEN Preview */}
                    <div>
                      <label
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                      >
                        Board Preview
                      </label>
                      <div className="border border-cb-border p-4 flex items-center justify-center min-h-[300px]">
                        {previewBoard ? (
                          <ChessBoard
                            board={previewBoard}
                            squareSize="sm"
                            isInteractive={false}
                            showCoordinates={false}
                          />
                        ) : (
                          <div className="text-center">
                            <p
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-sm text-cb-text-muted"
                            >
                              {formData.fen.trim()
                                ? "Invalid FEN - Cannot preview"
                                : "Enter a valid FEN to preview"}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Player Info Section */}
                <div>
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs tracking-[0.3em] uppercase text-cb-text-secondary mb-4"
                  >
                    Player Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* White Player */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-full bg-white border border-cb-text-muted" />
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-xs text-cb-text-secondary"
                        >
                          White Player
                        </span>
                      </div>

                      <LegendSearchDropdown
                        label="White Legend"
                        selectedLegend={selectedWhiteLegend}
                        onSelect={setSelectedWhiteLegend}
                        onClear={() => setSelectedWhiteLegend(null)}
                      />

                      <div>
                        <label
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                        >
                          White Player Name
                        </label>
                        <input
                          type="text"
                          value={formData.whitePlayerName}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              whitePlayerName: e.target.value,
                            })
                          }
                          className={cn(
                            "w-full px-4 py-3 bg-transparent border border-cb-border",
                            "text-cb-text placeholder-cb-text-faint",
                            "focus:outline-none focus:border-cb-text-muted transition-colors"
                          )}
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          placeholder="Player name (if not a legend)"
                        />
                      </div>

                      <div>
                        <label
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                        >
                          White Player Metadata (JSON)
                        </label>
                        <textarea
                          value={formData.whitePlayerMetadata}
                          onChange={(e) => {
                            setFormData({
                              ...formData,
                              whitePlayerMetadata: e.target.value,
                            });
                            if (errors.whitePlayerMetadata)
                              setErrors({
                                ...errors,
                                whitePlayerMetadata: undefined,
                              });
                          }}
                          rows={2}
                          className={cn(
                            "w-full px-4 py-3 bg-transparent border",
                            errors.whitePlayerMetadata
                              ? "border-red-500/50"
                              : "border-cb-border",
                            "text-cb-text placeholder-cb-text-faint resize-none font-mono text-xs",
                            "focus:outline-none focus:border-cb-text-muted transition-colors"
                          )}
                          placeholder='{"rating": 2800}'
                        />
                        {errors.whitePlayerMetadata && (
                          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {errors.whitePlayerMetadata}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Black Player */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-full bg-black border border-cb-text-muted" />
                        <span
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-xs text-cb-text-secondary"
                        >
                          Black Player
                        </span>
                      </div>

                      <LegendSearchDropdown
                        label="Black Legend"
                        selectedLegend={selectedBlackLegend}
                        onSelect={setSelectedBlackLegend}
                        onClear={() => setSelectedBlackLegend(null)}
                      />

                      <div>
                        <label
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                        >
                          Black Player Name
                        </label>
                        <input
                          type="text"
                          value={formData.blackPlayerName}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              blackPlayerName: e.target.value,
                            })
                          }
                          className={cn(
                            "w-full px-4 py-3 bg-transparent border border-cb-border",
                            "text-cb-text placeholder-cb-text-faint",
                            "focus:outline-none focus:border-cb-text-muted transition-colors"
                          )}
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          placeholder="Player name (if not a legend)"
                        />
                      </div>

                      <div>
                        <label
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                        >
                          Black Player Metadata (JSON)
                        </label>
                        <textarea
                          value={formData.blackPlayerMetadata}
                          onChange={(e) => {
                            setFormData({
                              ...formData,
                              blackPlayerMetadata: e.target.value,
                            });
                            if (errors.blackPlayerMetadata)
                              setErrors({
                                ...errors,
                                blackPlayerMetadata: undefined,
                              });
                          }}
                          rows={2}
                          className={cn(
                            "w-full px-4 py-3 bg-transparent border",
                            errors.blackPlayerMetadata
                              ? "border-red-500/50"
                              : "border-cb-border",
                            "text-cb-text placeholder-cb-text-faint resize-none font-mono text-xs",
                            "focus:outline-none focus:border-cb-text-muted transition-colors"
                          )}
                          placeholder='{"rating": 2750}'
                        />
                        {errors.blackPlayerMetadata && (
                          <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {errors.blackPlayerMetadata}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Game Info Section */}
                <div>
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs tracking-[0.3em] uppercase text-cb-text-secondary mb-4"
                  >
                    Game Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                      >
                        Tournament Name
                      </label>
                      <input
                        type="text"
                        value={formData.tournamentName}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            tournamentName: e.target.value,
                          })
                        }
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-cb-border",
                          "text-cb-text placeholder-cb-text-faint",
                          "focus:outline-none focus:border-cb-text-muted transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="World Chess Championship 2024"
                      />
                    </div>

                    <div>
                      <label
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                      >
                        Event Date
                      </label>
                      <input
                        type="datetime-local"
                        value={formData.eventDate}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            eventDate: e.target.value,
                          });
                          if (errors.eventDate)
                            setErrors({ ...errors, eventDate: undefined });
                        }}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border",
                          errors.eventDate
                            ? "border-red-500/50"
                            : "border-cb-border",
                          "text-cb-text",
                          "focus:outline-none focus:border-cb-text-muted transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                      />
                      {errors.eventDate && (
                        <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {errors.eventDate}
                        </p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                      >
                        Game Metadata (JSON)
                      </label>
                      <textarea
                        value={formData.gameMetadata}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            gameMetadata: e.target.value,
                          });
                          if (errors.gameMetadata)
                            setErrors({ ...errors, gameMetadata: undefined });
                        }}
                        rows={2}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border",
                          errors.gameMetadata
                            ? "border-red-500/50"
                            : "border-cb-border",
                          "text-cb-text placeholder-cb-text-faint resize-none font-mono text-xs",
                          "focus:outline-none focus:border-cb-text-muted transition-colors"
                        )}
                        placeholder='{"round": 5, "result": "1-0"}'
                      />
                      {errors.gameMetadata && (
                        <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {errors.gameMetadata}
                        </p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                      >
                        Position Context (JSON)
                      </label>
                      <textarea
                        value={formData.positionContext}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            positionContext: e.target.value,
                          });
                          if (errors.positionContext)
                            setErrors({
                              ...errors,
                              positionContext: undefined,
                            });
                        }}
                        rows={2}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border",
                          errors.positionContext
                            ? "border-red-500/50"
                            : "border-cb-border",
                          "text-cb-text placeholder-cb-text-faint resize-none font-mono text-xs",
                          "focus:outline-none focus:border-cb-text-muted transition-colors"
                        )}
                        placeholder='{"theme": "sacrifice", "difficulty": "hard"}'
                      />
                      {errors.positionContext && (
                        <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {errors.positionContext}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Source Section */}
                <div>
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs tracking-[0.3em] uppercase text-cb-text-secondary mb-4"
                  >
                    Source
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                      >
                        Source Type
                      </label>
                      <input
                        type="text"
                        value={formData.sourceType}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            sourceType: e.target.value,
                          })
                        }
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border border-cb-border",
                          "text-cb-text placeholder-cb-text-faint",
                          "focus:outline-none focus:border-cb-text-muted transition-colors"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        placeholder="admin"
                      />
                    </div>

                    <div>
                      <label
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="block text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
                      >
                        Source Metadata (JSON)
                      </label>
                      <textarea
                        value={formData.sourceMetadata}
                        onChange={(e) => {
                          setFormData({
                            ...formData,
                            sourceMetadata: e.target.value,
                          });
                          if (errors.sourceMetadata)
                            setErrors({ ...errors, sourceMetadata: undefined });
                        }}
                        rows={2}
                        className={cn(
                          "w-full px-4 py-3 bg-transparent border",
                          errors.sourceMetadata
                            ? "border-red-500/50"
                            : "border-cb-border",
                          "text-cb-text placeholder-cb-text-faint resize-none font-mono text-xs",
                          "focus:outline-none focus:border-cb-text-muted transition-colors"
                        )}
                        placeholder='{"importedFrom": "lichess"}'
                      />
                      {errors.sourceMetadata && (
                        <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {errors.sourceMetadata}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* System Section */}
                <div>
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs tracking-[0.3em] uppercase text-cb-text-secondary mb-4"
                  >
                    System
                  </h3>
                  <div className="flex items-center gap-8">
                    {/* Featured */}
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, featured: !formData.featured })}
                      className="flex items-center gap-3 group"
                    >
                      <div className={cn(
                        "w-10 h-5 border relative overflow-hidden transition-colors duration-300 flex-shrink-0",
                        formData.featured ? "border-cb-accent bg-cb-accent" : "border-cb-text-muted"
                      )}>
                        <motion.div
                          className={cn(
                            "absolute top-0 w-1/2 h-full transition-colors duration-300",
                            formData.featured ? "bg-cb-accent-fg" : "bg-cb-text-secondary"
                          )}
                          animate={{ left: formData.featured ? "50%" : "0%" }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                      </div>
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm text-cb-text-secondary group-hover:text-cb-text transition-colors"
                      >
                        Featured
                      </span>
                    </button>

                    {/* Is Active */}
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                      className="flex items-center gap-3 group"
                    >
                      <div className={cn(
                        "w-10 h-5 border relative overflow-hidden transition-colors duration-300 flex-shrink-0",
                        formData.isActive ? "border-cb-accent bg-cb-accent" : "border-cb-text-muted"
                      )}>
                        <motion.div
                          className={cn(
                            "absolute top-0 w-1/2 h-full transition-colors duration-300",
                            formData.isActive ? "bg-cb-accent-fg" : "bg-cb-text-secondary"
                          )}
                          animate={{ left: formData.isActive ? "50%" : "0%" }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                      </div>
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm text-cb-text-secondary group-hover:text-cb-text transition-colors"
                      >
                        Active
                      </span>
                    </button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className={cn(
                      "group relative overflow-hidden bg-cb-accent text-cb-accent-fg px-8 py-3 transition-all duration-300",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <motion.div
                      className="absolute inset-0 bg-cb-bg origin-left"
                      initial={{ scaleX: 0 }}
                      whileHover={{ scaleX: isSaving ? 0 : 1 }}
                      transition={{ duration: 0.3 }}
                    />
                    <span className="relative flex items-center gap-2 group-hover:text-cb-text transition-colors">
                      <Save className="w-4 h-4" strokeWidth={1.5} />
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="font-medium text-sm"
                      >
                        {isSaving
                          ? "Saving..."
                          : editingId
                            ? "Update Position"
                            : "Create Position"}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-6 py-3 border border-cb-border text-cb-text-secondary hover:text-cb-text hover:border-cb-text-muted transition-all"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Positions List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-2 border-cb-border-strong border-t-cb-text rounded-full animate-spin" />
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted text-sm"
                >
                  Loading positions...
                </p>
              </div>
            </div>
          ) : positions.length === 0 ? (
            <div className="border border-cb-border p-12 text-center">
              <div className="w-16 h-16 border border-cb-border-strong flex items-center justify-center mx-auto mb-6">
                <Crown className="w-6 h-6 text-cb-text-muted" strokeWidth={1.5} />
              </div>
              <h3
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-xl text-cb-text mb-2"
              >
                No positions yet
              </h3>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-sm mb-6"
              >
                Create your first chess position to get started
              </p>
              <button
                onClick={handleCreateNew}
                className="inline-flex items-center gap-2 px-6 py-3 bg-cb-accent text-cb-accent-fg hover:opacity-90 transition-colors"
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                <span className="font-medium text-sm">Add Position</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {positions.map((position) => {
                const board = getBoardForPosition(position.fen);
                const displayName =
                  position.whiteLegend?.name ||
                  position.whitePlayerName ||
                  "White";
                const opponentName =
                  position.blackLegend?.name ||
                  position.blackPlayerName ||
                  "Black";

                return (
                  <div
                    key={position.id}
                    className="group border border-cb-border hover:border-cb-border-strong transition-all duration-300"
                  >
                    <div className="p-4">
                      {/* Board Preview */}
                      <div className="mb-4 flex justify-center">
                        {board ? (
                          <div className="transform scale-75 origin-center">
                            <ChessBoard
                              board={board}
                              squareSize="sm"
                              isInteractive={false}
                              showCoordinates={false}
                            />
                          </div>
                        ) : (
                          <div className="w-[200px] h-[200px] border border-cb-border flex items-center justify-center">
                            <p className="text-xs text-cb-text-muted">
                              Invalid FEN
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Position Info */}
                      <div className="space-y-3">
                        {/* Players */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {position.whiteLegend?.profilePhotoUrl ? (
                              <Image
                                src={position.whiteLegend.profilePhotoUrl}
                                alt={displayName}
                                width={24}
                                height={24}
                                className="w-6 h-6 object-cover"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-white border border-cb-text-muted" />
                            )}
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-xs text-cb-text truncate max-w-[80px]"
                            >
                              {displayName}
                            </span>
                          </div>
                          <span
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-xs text-cb-text-muted"
                          >
                            vs
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-xs text-cb-text truncate max-w-[80px]"
                            >
                              {opponentName}
                            </span>
                            {position.blackLegend?.profilePhotoUrl ? (
                              <Image
                                src={position.blackLegend.profilePhotoUrl}
                                alt={opponentName}
                                width={24}
                                height={24}
                                className="w-6 h-6 object-cover"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-black border border-cb-text-muted" />
                            )}
                          </div>
                        </div>

                        {/* FEN (truncated) */}
                        <p
                          style={{ fontFamily: "'Geist', sans-serif" }}
                          className="text-[10px] text-cb-text-muted truncate font-mono"
                        >
                          {position.fen}
                        </p>

                        {/* Tournament */}
                        {position.tournamentName && (
                          <p
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-xs text-cb-text-secondary truncate"
                          >
                            {position.tournamentName}
                          </p>
                        )}

                        {/* Meta Row */}
                        <div className="flex items-center justify-between">
                          {/* Side to move indicator */}
                          <div className="flex items-center gap-2">
                            <div
                              className={cn(
                                "w-3 h-3 rounded-full border",
                                position.sideToMove === "white"
                                  ? "bg-white border-cb-text-muted"
                                  : "bg-black border-cb-text-muted"
                              )}
                            />
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-[10px] text-cb-text-muted"
                            >
                              {position.sideToMove} to move
                            </span>
                          </div>

                          {/* Badges */}
                          <div className="flex gap-1">
                            {position.featured && (
                              <span
                                className="px-1.5 py-0.5 text-[9px] border border-amber-500/30 bg-amber-500/10 text-amber-400 flex items-center gap-1"
                                style={{ fontFamily: "'Geist', sans-serif" }}
                              >
                                <Star className="w-2.5 h-2.5" />
                              </span>
                            )}
                            <span
                              className={cn(
                                "px-1.5 py-0.5 text-[9px] border",
                                position.isActive
                                  ? "border-cb-border-strong text-cb-text-secondary"
                                  : "border-cb-border text-cb-text-muted"
                              )}
                              style={{ fontFamily: "'Geist', sans-serif" }}
                            >
                              {position.isActive ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-2">
                          <button
                            onClick={() => handleEdit(position)}
                            className="flex-1 h-8 border border-cb-border flex items-center justify-center gap-2 hover:border-cb-text-muted hover:bg-cb-hover transition-all"
                          >
                            <Edit2
                              className="w-3 h-3 text-cb-text-secondary"
                              strokeWidth={1.5}
                            />
                            <span
                              style={{ fontFamily: "'Geist', sans-serif" }}
                              className="text-xs text-cb-text-secondary"
                            >
                              Edit
                            </span>
                          </button>
                          <button
                            onClick={() =>
                              handleDelete(position.referenceId, position.fen)
                            }
                            className="w-8 h-8 border border-cb-border flex items-center justify-center hover:border-red-500/50 hover:bg-red-500/10 transition-all"
                          >
                            <Trash2
                              className="w-3 h-3 text-cb-text-secondary"
                              strokeWidth={1.5}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Decorative corner elements */}
        <div className="fixed top-20 left-6 w-12 h-12 border-l border-t border-cb-border pointer-events-none" />
        <div className="fixed bottom-6 right-6 w-12 h-12 border-r border-b border-cb-border pointer-events-none" />
      </div>
    </>
  );
}
