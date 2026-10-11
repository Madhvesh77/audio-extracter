const express = require("express");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function parseTimestamp(value) {
  if (!value || !value.trim()) return null;

  const parts = value.trim().split(":").map(Number);

  if (
    parts.some((part) => !Number.isFinite(part) || part < 0) ||
    parts.length > 3
  ) {
    throw new Error("Invalid timestamp. Use seconds, MM:SS, or HH:MM:SS.");
  }

  if (parts.length === 1) return parts[0];

  if (parts.length === 2) {
    if (parts[1] >= 60) throw new Error("Invalid timestamp.");
    return parts[0] * 60 + parts[1];
  }

  if (parts[1] >= 60 || parts[2] >= 60) {
    throw new Error("Invalid timestamp.");
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function isValidYouTubeUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();

    return (
      ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
       "www.youtube-nocookie.com", "youtube-nocookie.com"].includes(host) ||
      host.endsWith(".youtube.com")
    ) && ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function safeFilename(title) {
  // Keep the first 20 characters, then remove filename-hostile characters.
  const cleaned = title
    .slice(0, 20)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  return cleaned || "DadTube Audio";
}

app.post("/api/download", async (req, res) => {
  let tempDir;

  try {
    const { url, startTime, endTime } = req.body || {};

    if (!url || !isValidYouTubeUrl(url)) {
      return res.status(400).json({
        error: "Please enter a valid YouTube URL."
      });
    }

    const start = parseTimestamp(startTime);
    const end = parseTimestamp(endTime);

    if (start !== null && end !== null && end <= start) {
      return res.status(400).json({
        error: "End time must be after start time."
      });
    }

    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dadtube-")
    );

    const outputTemplate = path.join(
      tempDir,
      "%(title).20s.%(ext)s"
    );

    // Download and convert the video's audio to MP3.
    await execFileAsync(
      "yt-dlp",
      [
        "--remote-components", "ejs:npm",
        "--no-playlist",
        "--no-warnings",
        "-f", "bestaudio",
        "-x",
        "--audio-format", "mp3",
        "-o", outputTemplate,
        url
      ],
      {
        timeout: 10 * 60 * 1000,
        maxBuffer: 2 * 1024 * 1024
      }
    );

    const files = await fs.promises.readdir(tempDir);
    const mp3File = files.find((file) =>
      file.toLowerCase().endsWith(".mp3")
    );

    if (!mp3File) {
      throw new Error("The MP3 file was not created.");
    }

    const downloadedFile = path.join(tempDir, mp3File);
    const filename = safeFilename(path.parse(mp3File).name) + ".mp3";

    let finalFile = downloadedFile;

    // If a start or end time was provided, trim the audio with FFmpeg.
    if (start !== null || end !== null) {
      finalFile = path.join(tempDir, `trimmed-${crypto.randomUUID()}.mp3`);

      const ffmpegArgs = ["-y", "-i", downloadedFile];

      if (start !== null) {
        ffmpegArgs.push("-ss", String(start));
      }

      if (end !== null) {
        const duration = end - (start ?? 0);
        ffmpegArgs.push("-t", String(duration));
      }

      ffmpegArgs.push(
        "-vn",
        "-codec:a", "libmp3lame",
        "-q:a", "2",
        finalFile
      );

      await execFileAsync("ffmpeg", ffmpegArgs, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 2 * 1024 * 1024
      });
    }

    res.download(finalFile, filename, async (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({
          error: "The MP3 download failed."
        });
      }

      try {
        await fs.promises.rm(tempDir, {
          recursive: true,
          force: true
        });
      } catch (cleanupError) {
        console.error("Temporary file cleanup failed:", cleanupError);
      }
    });
  } catch (error) {
    console.error("DadTube download error:", error);

    if (tempDir) {
      try {
        await fs.promises.rm(tempDir, {
          recursive: true,
          force: true
        });
      } catch (cleanupError) {
        console.error("Temporary file cleanup failed:", cleanupError);
      }
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: "Could not download the audio. Please try another video."
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`DadTube is running at http://localhost:${PORT}`);
});
