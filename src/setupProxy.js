const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const BACKUP_ROOT = path.join(process.cwd(), "local-backup");
const EVENTS_ROOT = path.join(BACKUP_ROOT, "events");

const sanitizeSegment = (value, fallback = "unknown") => {
  const normalized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
};

const isFirebaseStorageUrl = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname === "firebasestorage.googleapis.com" &&
      parsed.pathname.startsWith("/v0/b/")
    );
  } catch {
    return false;
  }
};

const resolveImageExtension = (contentType, sourceUrl) => {
  const typeToExt = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
  };

  if (contentType && typeToExt[contentType.toLowerCase()]) {
    return typeToExt[contentType.toLowerCase()];
  }

  try {
    return path.extname(new URL(sourceUrl).pathname) || ".jpg";
  } catch {
    return ".jpg";
  }
};

const serializeEvent = (value) => {
  if (Array.isArray(value)) {
    return value.map(serializeEvent);
  }

  if (value && typeof value === "object") {
    if (
      typeof value.seconds === "number" &&
      typeof value.nanoseconds === "number"
    ) {
      return {
        seconds: value.seconds,
        nanoseconds: value.nanoseconds,
        iso: new Date(value.seconds * 1000).toISOString(),
      };
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        serializeEvent(nestedValue),
      ]),
    );
  }

  return value;
};

const writeJsonFile = async (filePath, data) => {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const writeTextFile = async (filePath, text) => {
  await fs.writeFile(filePath, `${text.trimEnd()}\n`, "utf8");
};

const formatLabel = (key) =>
  String(key || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
};

const formatEventText = ({ backupAt, event, images }) => {
  const lines = [
    "METROZONE CSR EVENT BACKUP",
    "==========================",
    "",
    `Backup Generated At : ${backupAt}`,
    `Event ID            : ${event.id || "N/A"}`,
    "",
    "EVENT DETAILS",
    "-------------",
  ];

  for (const [key, value] of Object.entries(event)) {
    if (key === "createdAt") {
      continue;
    }

    if (key === "images" || key === "mainImage") {
      continue;
    }

    lines.push(`${formatLabel(key)} : ${formatValue(value)}`);
  }

  lines.push("");
  lines.push("IMAGE FILES");
  lines.push("-----------");

  if (!images.length) {
    lines.push("No image references found.");
  } else {
    images.forEach((image, index) => {
      lines.push(`${index + 1}. ${image.label}`);
      lines.push(`   Status : ${image.status}`);
      lines.push(`   Source : ${image.source || "N/A"}`);
      if (image.file) {
        lines.push(`   Local  : ${image.file}`);
      }
      if (image.reason) {
        lines.push(`   Note   : ${image.reason}`);
      }
      if (image.error) {
        lines.push(`   Error  : ${image.error}`);
      }
    });
  }

  return lines.join("\n");
};

const formatIndexText = (index) => {
  const lines = [
    "METROZONE CSR BACKUP INDEX",
    "==========================",
    "",
    `Backup Generated At : ${index.backupAt}`,
    `Total Events        : ${index.totalEvents}`,
    "",
    "EVENT LIST",
    "----------",
  ];

  if (!index.events.length) {
    lines.push("No events found.");
    return lines.join("\n");
  }

  index.events.forEach((event, indexValue) => {
    lines.push(`${indexValue + 1}. ${event.title || "Untitled Event"}`);
    lines.push(`   ID          : ${event.id || "N/A"}`);
    lines.push(`   Event Date  : ${event.eventDate || "N/A"}`);
    lines.push(`   Program     : ${event.programType || "N/A"}`);
    lines.push(`   Folder      : ${event.folder || "N/A"}`);
    lines.push(
      `   Images      : ${event.imagesCount || 0}/${event.totalImageReferences || 0} saved`,
    );
  });

  return lines.join("\n");
};

const removeStaleDirectories = async (keepDirectories) => {
  const entries = await fs.readdir(EVENTS_ROOT, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !keepDirectories.has(entry.name))
      .map((entry) =>
        fs.rm(path.join(EVENTS_ROOT, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );
};

module.exports = function setupProxy(app) {
  app.use(express.json({ limit: "25mb" }));

  app.get("/api/image-proxy", async (req, res) => {
    const rawUrl = req.query?.url;
    if (!rawUrl || typeof rawUrl !== "string") {
      return res.status(400).json({ error: "Missing url query param" });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "Invalid url" });
    }

    const isFirebaseStorage =
      parsed.hostname === "firebasestorage.googleapis.com" &&
      parsed.pathname.startsWith("/v0/b/");
    if (!isFirebaseStorage) {
      return res.status(403).json({ error: "URL not allowed" });
    }

    try {
      const upstream = await fetch(parsed.toString(), {
        headers: {
          Accept: "image/*,*/*;q=0.8",
        },
      });

      if (!upstream.ok) {
        return res
          .status(upstream.status)
          .json({ error: "Upstream fetch failed" });
      }

      const contentType =
        upstream.headers.get("content-type") || "application/octet-stream";
      const cacheControl =
        upstream.headers.get("cache-control") || "public, max-age=3600";
      const buffer = Buffer.from(await upstream.arrayBuffer());

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", cacheControl);
      return res.status(200).send(buffer);
    } catch (err) {
      return res.status(502).json({
        error: "Failed to fetch upstream image",
        details: err?.message || "unknown error",
      });
    }
  });

  app.post("/api/local-backup/sync", async (req, res) => {
    const events = req.body?.events;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: "Expected an events array" });
    }

    try {
      await fs.mkdir(EVENTS_ROOT, { recursive: true });

      const backupAt = new Date().toISOString();
      const index = {
        backupAt,
        totalEvents: events.length,
        events: [],
      };
      const keepDirectories = new Set();

      for (const rawEvent of events) {
        const event = serializeEvent(rawEvent);
        const eventId = sanitizeSegment(event.id, "event");
        const eventTitle = sanitizeSegment(event.title, "untitled-event");
        const eventFolderName = `${eventId}__${eventTitle}`;
        const eventFolderPath = path.join(EVENTS_ROOT, eventFolderName);
        const imagesFolderPath = path.join(eventFolderPath, "images");

        keepDirectories.add(eventFolderName);
        await fs.mkdir(imagesFolderPath, { recursive: true });

        const imageSources = [
          { source: event.mainImage, label: "main" },
          ...((Array.isArray(event.images) ? event.images : []).map(
            (source, indexValue) => ({
              source,
              label: `gallery-${String(indexValue + 1).padStart(2, "0")}`,
            }),
          )),
        ].filter((item) => typeof item.source === "string" && item.source.trim());

        const imageEntries = [];

        for (const item of imageSources) {
          if (!isFirebaseStorageUrl(item.source)) {
            imageEntries.push({
              label: item.label,
              source: item.source,
              status: "skipped",
              reason:
                "Only Firebase Storage download URLs are supported for local backup sync.",
            });
            continue;
          }

          try {
            const response = await fetch(item.source, {
              headers: {
                Accept: "image/*,*/*;q=0.8",
              },
            });

            if (!response.ok) {
              throw new Error(`Image fetch failed with status ${response.status}`);
            }

            const extension = resolveImageExtension(
              response.headers.get("content-type"),
              item.source,
            );
            const fileName = `${item.label}${extension}`;
            const outputPath = path.join(imagesFolderPath, fileName);
            const buffer = Buffer.from(await response.arrayBuffer());

            await fs.writeFile(outputPath, buffer);

            imageEntries.push({
              label: item.label,
              source: item.source,
              file: path.posix.join("images", fileName),
              status: "saved",
            });
          } catch (error) {
            imageEntries.push({
              label: item.label,
              source: item.source,
              status: "failed",
              error: error?.message || "unknown error",
            });
          }
        }

        await writeJsonFile(path.join(eventFolderPath, "event.json"), {
          backupAt,
          event,
          images: imageEntries,
        });
        await writeTextFile(
          path.join(eventFolderPath, "event.txt"),
          formatEventText({
            backupAt,
            event,
            images: imageEntries,
          }),
        );

        index.events.push({
          id: event.id || "",
          title: event.title || "",
          eventDate: event.eventDate || "",
          programType: event.programType || "",
          folder: path.posix.join("events", eventFolderName),
          imagesCount: imageEntries.filter((entry) => entry.status === "saved")
            .length,
          totalImageReferences: imageEntries.length,
        });
      }

      await removeStaleDirectories(keepDirectories);
      await writeJsonFile(path.join(BACKUP_ROOT, "index.json"), index);
      await writeTextFile(path.join(BACKUP_ROOT, "index.txt"), formatIndexText(index));

      return res.status(200).json({
        success: true,
        backupRoot: BACKUP_ROOT,
        totalEvents: index.totalEvents,
      });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to sync local backup",
        details: error?.message || "unknown error",
      });
    }
  });
};
