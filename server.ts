import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";

const db = new Database("osis_election.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vision TEXT,
    mission TEXT,
    image_url TEXT
  );

  CREATE TABLE IF NOT EXISTS voters (
    id TEXT PRIMARY KEY,
    has_voted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    voter_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (candidate_id) REFERENCES candidates (id),
    FOREIGN KEY (voter_id) REFERENCES voters (id)
  );
`);

// Seed candidates if empty
const candidateCount = db.prepare("SELECT COUNT(*) as count FROM candidates").get() as { count: number };
if (candidateCount.count === 0) {
  const insert = db.prepare("INSERT INTO candidates (name, vision, mission, image_url) VALUES (?, ?, ?, ?)");
  insert.run("Calon 1: Ahmad Fauzi", "Mewujudkan OSIS yang inovatif dan kolaboratif.", "1. Mengadakan workshop teknologi. 2. Meningkatkan kegiatan ekstrakurikuler.", "https://picsum.photos/seed/candidate1/400/400");
  insert.run("Calon 2: Siti Aminah", "Membangun karakter siswa yang berakhlak mulia.", "1. Program literasi pagi. 2. Bakti sosial rutin.", "https://picsum.photos/seed/candidate2/400/400");
  insert.run("Calon 3: Budi Santoso", "Meningkatkan prestasi olahraga dan seni.", "1. Renovasi fasilitas olahraga. 2. Pentas seni bulanan.", "https://picsum.photos/seed/candidate3/400/400");
}

// Seed some test voters (NIS)
const voterCount = db.prepare("SELECT COUNT(*) as count FROM voters").get() as { count: number };
if (voterCount.count === 0) {
  const insertVoter = db.prepare("INSERT INTO voters (id) VALUES (?)");
  for (let i = 1001; i <= 1050; i++) {
    insertVoter.run(i.toString());
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/candidates", (req, res) => {
    const candidates = db.prepare("SELECT * FROM candidates").all();
    res.json(candidates);
  });

  app.get("/api/results", (req, res) => {
    const results = db.prepare(`
      SELECT c.name, COUNT(v.id) as vote_count 
      FROM candidates c 
      LEFT JOIN votes v ON c.id = v.candidate_id 
      GROUP BY c.id
    `).all();
    res.json(results);
  });

  app.post("/api/vote", (req, res) => {
    const { voterId, candidateId } = req.body;

    if (!voterId || !candidateId) {
      return res.status(400).json({ error: "Data tidak lengkap" });
    }

    const voter = db.prepare("SELECT * FROM voters WHERE id = ?").get(voterId) as { id: string, has_voted: number } | undefined;

    if (!voter) {
      return res.status(404).json({ error: "NIS tidak terdaftar" });
    }

    if (voter.has_voted) {
      return res.status(400).json({ error: "Anda sudah memberikan suara" });
    }

    const transaction = db.transaction(() => {
      db.prepare("INSERT INTO votes (candidate_id, voter_id) VALUES (?, ?)").run(candidateId, voterId);
      db.prepare("UPDATE voters SET has_voted = 1 WHERE id = ?").run(voterId);
    });

    try {
      transaction();
      res.json({ success: true, message: "Suara berhasil dikirim!" });
    } catch (err) {
      res.status(500).json({ error: "Gagal memproses suara" });
    }
  });

  // Admin API Routes
  app.get("/api/admin/stats", (req, res) => {
    const totalVoters = db.prepare("SELECT COUNT(*) as count FROM voters").get() as { count: number };
    const votedCount = db.prepare("SELECT COUNT(*) as count FROM voters WHERE has_voted = 1").get() as { count: number };
    const candidates = db.prepare("SELECT * FROM candidates").all();
    
    res.json({
      totalVoters: totalVoters.count,
      votedCount: votedCount.count,
      candidates
    });
  });

  app.post("/api/admin/candidates", (req, res) => {
    const { name, vision, mission, image_url } = req.body;
    if (!name) return res.status(400).json({ error: "Nama wajib diisi" });
    
    const info = db.prepare("INSERT INTO candidates (name, vision, mission, image_url) VALUES (?, ?, ?, ?)")
      .run(name, vision || "", mission || "", image_url || `https://picsum.photos/seed/${Date.now()}/400/400`);
    
    res.json({ success: true, id: info.lastInsertRowid });
  });

  app.delete("/api/admin/candidates/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM candidates WHERE id = ?").run(id);
    res.json({ success: true });
  });

  app.get("/api/admin/voters", (req, res) => {
    const voters = db.prepare("SELECT * FROM voters ORDER BY id ASC").all();
    res.json(voters);
  });

  app.post("/api/admin/voters", (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "NIS wajib diisi" });
    
    try {
      db.prepare("INSERT INTO voters (id) VALUES (?)").run(id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: "NIS sudah terdaftar" });
    }
  });

  app.delete("/api/admin/voters/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM voters WHERE id = ?").run(id);
    res.json({ success: true });
  });

  app.post("/api/admin/reset", (req, res) => {
    const transaction = db.transaction(() => {
      db.prepare("DELETE FROM votes").run();
      db.prepare("UPDATE voters SET has_voted = 0").run();
    });
    transaction();
    res.json({ success: true, message: "Data pemilihan berhasil direset" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
