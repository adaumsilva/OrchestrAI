// Renders the app icon (the same artwork as the tray icon) to build/icon.png. Run with: npx electron scripts/make-icon.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { makeIcon } = require('../src/services/tray');

app.whenReady().then(() => {
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, makeIcon(512).toPNG());
  console.log('wrote', out);
  app.quit();
});
