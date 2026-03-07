const { URL } = require("url");

module.exports = function setupProxy(app) {
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
};
