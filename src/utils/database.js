/**
 * Cavor-Xv3-11/x — Database Init
 * Copyright © 2025 CAVOR
 */
"use strict";
const fs   = require("fs-extra");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "database/data");
const DB_FILE  = path.join(DATA_DIR, "cavor.json");

async function initDB() {
  fs.ensureDirSync(DATA_DIR);
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ threads: {}, users: {}, created: Date.now() }, null, 2));
  }
  global.db = {
    allThreadData: [],
    allUserData:   [],
    _path: DB_FILE,
  };
}

module.exports = { initDB };
