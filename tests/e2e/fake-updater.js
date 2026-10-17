// Stand-in for electron-updater's autoUpdater, used through ORCH_UPDATER_MODULE.
const { EventEmitter } = require('events');

const u = new EventEmitter();
u.autoDownload = true; // the service must turn this off
u.autoInstallOnAppQuit = true;
u.calls = [];
u.checkForUpdates = async () => {
  u.calls.push('check');
  u.emit('checking-for-update');
  setTimeout(() => u.emit('update-available', { version: '9.9.9', releaseNotes: '<h2>9.9.9</h2><p>New <b>stuff</b> &amp; fixes</p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul>' }), 30);
};
u.downloadUpdate = async () => {
  u.calls.push('download');
  setTimeout(() => u.emit('download-progress', { percent: 50 }), 20);
  setTimeout(() => { u.emit('download-progress', { percent: 100 }); u.emit('update-downloaded', { version: '9.9.9' }); }, 60);
};
u.quitAndInstall = () => { u.calls.push('install'); global.__fakeInstalled = true; };
module.exports = u;
