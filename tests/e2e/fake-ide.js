// Stand-in editor: records its arguments to the file named by FAKE_IDE_OUT.
require('fs').writeFileSync(process.env.FAKE_IDE_OUT, JSON.stringify(process.argv.slice(2)));
