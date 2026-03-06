import React, { useState, useEffect } from "react";
import { db, storage } from "../firebaseConfig";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  orderBy,
  query,
} from "firebase/firestore";
import { Button, Table } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { deleteObject, getDownloadURL, ref } from "firebase/storage";
import Loader from "./Loader";
import { jsPDF } from "jspdf";

/* ─── helpers ─────────────────────────────────────────────────── */

/**
 * Load Noto Sans Regular (TTF) from jsDelivr CDN and register it with jsPDF.
 * Supports Latin, Devanagari (Hindi), Gujarati, Bengali, and many other scripts.
 * Falls back to "helvetica" if the CDN is unreachable.
 */
const loadUnicodeFont = async (pdf) => {
  try {
    const fontUrl =
      "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf";
    const resp = await fetch(fontUrl);
    if (!resp.ok) throw new Error("font fetch failed");
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++)
      binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    pdf.addFileToVFS("NotoSans.ttf", base64);
    pdf.addFont("NotoSans.ttf", "NotoSans", "normal");
    return "NotoSans";
  } catch (e) {
    console.warn(
      "Unicode font unavailable, falling back to helvetica:",
      e.message,
    );
    return "helvetica";
  }
};

// Wrap text to fit maxWidth (pt). Call AFTER setting font + size on pdf.
const splitText = (pdf, text, maxWidth) =>
  pdf.splitTextToSize(String(text || ""), maxWidth);

const resolveImageUrl = async (source) => {
  if (!source || typeof source !== "string") return null;
  if (/^https?:\/\//i.test(source)) {
    const isFirebaseMediaUrl =
      source.includes("firebasestorage.googleapis.com") &&
      source.includes("/o/");
    const hasToken = source.includes("token=");
    if (isFirebaseMediaUrl && !hasToken) {
      try {
        return await getDownloadURL(ref(storage, source));
      } catch {
        return source;
      }
    }
    return source;
  }
  try {
    return await getDownloadURL(ref(storage, source));
  } catch (err) {
    console.warn(
      "Failed to resolve storage path to URL:",
      source,
      err?.message,
    );
    return null;
  }
};

// Convert Storage source (download URL / gs:// / path) to data URL.
const toDataUrl = async (source) => {
  if (!source) return null;
  try {
    const imageUrl = await resolveImageUrl(source);
    if (!imageUrl) return null;
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("Failed to load image for PDF:", source, err?.message || err);
    return null;
  }
};

const drawPlaceholder = (pdf, x, y, w, h, label, fontName) => {
  pdf.setDrawColor(190, 190, 190);
  pdf.setFillColor(248, 248, 248);
  pdf.rect(x, y, w, h, "FD");
  pdf.setFont(fontName, "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(130, 130, 130);
  pdf.text(label, x + w / 2, y + h / 2 + 3, { align: "center" });
};

const getImageFormat = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== "string") return "JPEG";
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg)/i);
  if (!match) return "JPEG";
  const raw = match[1].toUpperCase();
  return raw === "JPG" ? "JPEG" : raw;
};

/* ─── PDF generation ──────────────────────────────────────────── */

const generatePDF = async (selectedEventsList) => {
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;

  // Load Unicode font once — shared by all pages
  const fontName = await loadUnicodeFont(pdf);

  for (let ei = 0; ei < selectedEventsList.length; ei++) {
    const event = selectedEventsList[ei];

    if (ei > 0) pdf.addPage();

    // Hard-reset state at top of every page (only "normal" style — no bold/italic)
    pdf.setFont(fontName, "normal");
    pdf.setFontSize(12);
    pdf.setTextColor(0, 0, 0);
    pdf.setDrawColor(0, 0, 0);
    pdf.setFillColor(255, 255, 255);

    /* ── 1. Header bar ─────────────────────────────────────────── */
    pdf.setFillColor(30, 80, 162);
    pdf.rect(0, 0, pageW, 58, "F");

    // Sub-label
    pdf.setFont(fontName, "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(180, 210, 255);
    pdf.text("METROZONE CSR EVENT REPORT", pageW - margin, 14, {
      align: "right",
    });

    // Title — original language/case, Unicode font
    pdf.setFont(fontName, "normal");
    pdf.setFontSize(16);
    pdf.setTextColor(255, 255, 255);
    const titleLines = splitText(
      pdf,
      event.title || "Untitled Event",
      contentW - 20,
    );
    titleLines.forEach((line, li) => pdf.text(line, margin, 34 + li * 18));

    /* ── 2. Metadata rows ──────────────────────────────────────── */
    let curY = 72;
    const col1X = margin;
    const col2X = margin + 130;
    const rowH = 22;

    const meta = [
      ["Program Type", event.programType || "—"],
      ["Event Date", event.eventDate || "—"],
      ["Partner", event.partner || "—"],
      ["Location", event.eventVenue || "—"],
    ];

    meta.forEach(([label, value], idx) => {
      if (idx % 2 === 0) {
        pdf.setFillColor(240, 245, 255);
        pdf.rect(margin, curY - 15, contentW, rowH, "F");
      }
      pdf.setFont(fontName, "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(60, 60, 60);
      pdf.text(label.toUpperCase(), col1X, curY);

      pdf.setFont(fontName, "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(20, 20, 20);
      const valLines = splitText(pdf, String(value), contentW - 135);
      valLines.forEach((vl, vli) => pdf.text(vl, col2X, curY + vli * 12));
      curY += rowH;
    });

    curY += 10;

    /* ── 3. Divider ────────────────────────────────────────────── */
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, curY, pageW - margin, curY);
    curY += 14;

    /* ── 4. Description ────────────────────────────────────────── */
    pdf.setFont(fontName, "normal");
    pdf.setFontSize(11);
    pdf.setTextColor(30, 80, 162);
    pdf.text("PROGRAM DETAILS", margin, curY);
    curY += 14;

    pdf.setFont(fontName, "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(40, 40, 40);
    const descLines = splitText(
      pdf,
      event.description || "No description provided.",
      contentW,
    );
    const maxDescLines = Math.min(descLines.length, 8);
    descLines.slice(0, maxDescLines).forEach((dl) => {
      pdf.text(dl, margin, curY);
      curY += 12;
    });
    if (descLines.length > maxDescLines) {
      pdf.setFontSize(8.5);
      pdf.setTextColor(120, 120, 120);
      pdf.text(
        "(Description truncated — see full details on the event page.)",
        margin,
        curY,
      );
      curY += 12;
    }

    /* ── 5. Images (main + first 4 gallery) ───────────────────── */
    curY += 6;
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, curY, pageW - margin, curY);
    curY += 14;

    pdf.setFont(fontName, "normal");
    pdf.setFontSize(11);
    pdf.setTextColor(30, 80, 162);
    pdf.text("EVENT IMAGES", margin, curY);
    curY += 12;

    const mainImageH = 120;
    const mainData = await toDataUrl(event.mainImage);
    if (mainData) {
      try {
        pdf.addImage(
          mainData,
          getImageFormat(mainData),
          margin,
          curY,
          contentW,
          mainImageH,
        );
      } catch {
        drawPlaceholder(
          pdf,
          margin,
          curY,
          contentW,
          mainImageH,
          "Main image unavailable",
          fontName,
        );
      }
    } else {
      drawPlaceholder(
        pdf,
        margin,
        curY,
        contentW,
        mainImageH,
        "Main image not available",
        fontName,
      );
    }
    curY += mainImageH + 10;

    const gallery = (event.images || []).slice(0, 6);
    const gap = 8;
    const thumbW = (contentW - gap) / 2;
    const thumbH = 90;

    for (let gi = 0; gi < gallery.length; gi++) {
      const row = Math.floor(gi / 2);
      const col = gi % 2;
      const x = margin + col * (thumbW + gap);
      const y = curY + row * (thumbH + gap);
      const data = await toDataUrl(gallery[gi]);

      if (data) {
        try {
          pdf.addImage(data, getImageFormat(data), x, y, thumbW, thumbH);
          continue;
        } catch {
          // fall through to placeholder
        }
      }
      drawPlaceholder(
        pdf,
        x,
        y,
        thumbW,
        thumbH,
        `Image ${gi + 1} not available`,
        fontName,
      );
    }

    /* ── 6. Footer ─────────────────────────────────────────────── */
    pdf.setFillColor(30, 80, 162);
    pdf.rect(0, pageH - 28, pageW, 28, "F");
    pdf.setFont(fontName, "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(200, 220, 255);
    pdf.text(
      `Metrozone CSR Report  |  Generated: ${new Date().toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
          year: "numeric",
        },
      )}`,
      margin,
      pageH - 10,
    );
    pdf.text(
      `Page ${ei + 1} of ${selectedEventsList.length}`,
      pageW - margin,
      pageH - 10,
      { align: "right" },
    );
  }

  pdf.save(`Metrozone_Events_${new Date().toISOString().slice(0, 10)}.pdf`);
};

/* ─── Component ───────────────────────────────────────────────── */

const EventTable = () => {
  const [events, setEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [filter, setFilter] = useState("All");
  const [activefilter, setActiveFilter] = useState("All");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const navigate = useNavigate();

  // Fetch events from Firestore
  const fetchEvents = async () => {
    const eventsRef = collection(db, "events");
    const q = query(eventsRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    const eventsList = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    setEvents(eventsList);
    setFilteredEvents(eventsList);
  };

  // Delete event
  const handleDelete = async (id) => {
    setLoading(true);
    setDeletingId(id);
    try {
      const eventDocRef = doc(db, "events", id);
      const eventDoc = await getDoc(eventDocRef);
      if (eventDoc.exists()) {
        const eventData = eventDoc.data();
        const imagesUrls = eventData.images || [];
        const deleteImagePromises = imagesUrls.map((url) => {
          const imageRef = ref(storage, url);
          return deleteObject(imageRef).catch(() => {});
        });
        if (eventData.mainImage) {
          const mainImageRef = ref(storage, eventData.mainImage);
          await deleteObject(mainImageRef).catch(() => {});
        }
        await Promise.all(deleteImagePromises);
        await deleteDoc(eventDocRef);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetchEvents();
      }
    } catch (error) {
      console.error("Error deleting event:", error);
    } finally {
      setLoading(false);
      setDeletingId(null);
    }
  };

  // Apply filter
  useEffect(() => {
    if (filter === "All") {
      setFilteredEvents(events);
      setActiveFilter("All Events");
    } else if (filter === "Others") {
      setFilteredEvents(
        events.filter(
          (e) =>
            !["Health", "Education", "Sports", "Womens Empowerment"].includes(
              e.programType,
            ),
        ),
      );
      setActiveFilter("Others");
    } else {
      setFilteredEvents(events.filter((e) => e.programType === filter));
      setActiveFilter(filter);
    }
    // Clear selection when filter changes
    setSelectedIds(new Set());
  }, [filter, events]);

  useEffect(() => {
    fetchEvents();
  }, []);

  // Checkbox handlers
  const allSelected =
    filteredEvents.length > 0 &&
    filteredEvents.every((e) => selectedIds.has(e.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEvents.map((e) => e.id)));
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // PDF handler
  const handleGeneratePDF = async () => {
    const selected = filteredEvents.filter((e) => selectedIds.has(e.id));
    if (selected.length === 0) return;
    setGeneratingPdf(true);
    try {
      await generatePDF(selected);
    } catch (err) {
      console.error("PDF generation error:", err);
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div className="container mt-4">
      {/* ── Toolbar ── */}
      <div className="container d-flex flex-row flex-wrap gap-3 align-items-center mb-4 position-sticky top-0 bg-white py-3 ">
        {/* Add Event */}
        <button
          className="btn btn-success text-white fw-bold"
          onClick={() => navigate("/event")}
        >
          Add Event +
        </button>

        {/* Filter Dropdown */}
        <div className="dropdown">
          <button
            className="btn fw-bold text-white dropdown-toggle"
            style={{ background: "#4584ddff" }}
            type="button"
            id="dropdownMenuButton"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            Filter By <i className="fas fa-filter"></i>
          </button>
          <ul className="dropdown-menu" aria-labelledby="dropdownMenuButton">
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("All")}
              >
                All Events
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Health")}
              >
                Health
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Education")}
              >
                Education
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Sports")}
              >
                Sports
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Womens Empowerment")}
              >
                Womens Empowerment
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={() => setFilter("Others")}
              >
                Filter by other events
              </button>
            </li>
          </ul>
        </div>

        {/* Active filter badge */}
        <button
          className="btn"
          style={{
            background: "#e3fae7ff",
            color: "#008a09ff",
            border: "1px solid #008a09ff",
          }}
        >
          Filtered by {activefilter}
        </button>

        {/* Generate PDF button */}
        <button
          className="btn fw-bold text-white d-flex align-items-center gap-2"
          style={{
            background:
              selectedIds.size === 0
                ? "#aaa"
                : generatingPdf
                  ? "#c0392b"
                  : "#e74c3c",
            cursor: selectedIds.size === 0 ? "not-allowed" : "pointer",
            transition: "background 0.2s",
          }}
          onClick={handleGeneratePDF}
          disabled={selectedIds.size === 0 || generatingPdf}
          title={
            selectedIds.size === 0
              ? "Select at least one event to generate PDF"
              : `Generate PDF for ${selectedIds.size} event(s)`
          }
        >
          {generatingPdf ? (
            <>
              <span
                className="spinner-border spinner-border-sm"
                role="status"
                aria-hidden="true"
              ></span>
              Generating...
            </>
          ) : (
            <>
              <i className="fas fa-file-pdf"></i>
              Generate Events PDF
              {selectedIds.size > 0 && (
                <span
                  className="badge rounded-pill ms-1"
                  style={{
                    background: "white",
                    color: "#e74c3c",
                    fontSize: "0.75rem",
                  }}
                >
                  {selectedIds.size}
                </span>
              )}
            </>
          )}
        </button>
      </div>

      <h2 className="mb-4">Events Table</h2>

      <Table striped bordered hover>
        <thead>
          <tr>
            {/* Select-all checkbox */}
            <th style={{ width: "42px", textAlign: "center" }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                title="Select / deselect all visible events"
                style={{ cursor: "pointer", width: "16px", height: "16px" }}
              />
            </th>
            <th>Program</th>
            <th>Title</th>
            <th>Partner</th>
            <th>Location</th>
            <th>Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredEvents.length === 0 && (
            <tr>
              <td colSpan="7">No events found.</td>
            </tr>
          )}
          {filteredEvents.map((event) => (
            <tr
              key={event.id}
              style={{
                background: selectedIds.has(event.id) ? "#eef4ff" : undefined,
              }}
            >
              {/* Row checkbox */}
              <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(event.id)}
                  onChange={() => toggleSelect(event.id)}
                  style={{ cursor: "pointer", width: "16px", height: "16px" }}
                />
              </td>
              <td>{event.programType}</td>
              <td>{event.title}</td>
              <td className="col-2">{event.partner}</td>
              <td className="col-3">{event.eventVenue}</td>
              <td className="col-1">{event.eventDate}</td>
              <td>
                <Button
                  variant="warning"
                  onClick={() => navigate(`/update/${event.id}`)}
                >
                  Update
                </Button>
                <Button
                  variant="danger"
                  className="ml-2 m-1"
                  onClick={() => handleDelete(event.id)}
                  disabled={loading && deletingId === event.id}
                >
                  {loading && deletingId === event.id
                    ? "Deleting..."
                    : "Delete"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {loading && <Loader />}
    </div>
  );
};

export default EventTable;
